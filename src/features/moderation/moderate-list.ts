import 'server-only'
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm'
import { db, jobs, steps, templates, templateVersions } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { captureError } from '@/shared/observability'
import { moderateContent, type ModerationVerdict } from '@/shared/ai/moderate'
import { getApiKey } from '@/shared/settings/ai'
import { publicationDecision } from '@/shared/moderation/publication-state'
import { globalBudgetOk } from '@/shared/quota'
import { enqueueJob } from '@/shared/jobs/queue'
import {
  checkSpamHeuristics,
  contentFingerprint,
  fingerprintBody,
  MIN_FINGERPRINT_BODY,
  routeVerdict,
  type ListSignals,
} from './automation'

const flat = (x: LocaleText | null | undefined) => (x ? Object.values(x).filter(Boolean).join(' / ') : '')

/** Все строковые листья произвольного JSON: md text-блока, вопрос/варианты/explain
 *  квиза, question/options поллинга, caption/url видео, элементы subtasks и т.п.
 *  Нужно, чтобы контент rich-блоков (steps.content) попадал в модерацию, а не только
 *  title/desc/command шага — иначе опасное how-to прячется в markdown-блоке мимо гейта. */
function contentStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(contentStrings)
  if (v && typeof v === 'object') return Object.values(v).flatMap(contentStrings)
  return []
}

// Кап LLM-проверок на автора в сутки: защита от расхода OpenRouter циклом
// publish/save (git push пропускает до 240 запросов/мин — без капа это деньги).
// Экспортируется затем, что из него выведен предел пакетной публикации: смысла публиковать
// за раз больше, чем проверка успевает за сутки, нет (см. library/publish-draft).
export const MODERATE_DAILY_CAP = 20

interface LoadedList {
  signals: ListSignals
  stepTitles: string[]
  ownerId: string
  moderation: string
}

/** Сигналы списка для проверки: текст (LLM + извлечение ссылок), заголовки шагов
 *  (отпечаток), счётчики (эвристики). Берём ПОСЛЕДНЮЮ версию — проверяем то,
 *  что реально увидит зритель после правки. URL из refs — в начале текста,
 *  чтобы не отрезались лимитом классификатора (4000 символов). */
async function loadListSignals(templateId: string): Promise<LoadedList | null> {
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return null
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.version))
    .limit(1)
  const stepRows = ver ? await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n)) : []
  const refs = stepRows.flatMap((s) => (Array.isArray(s.refs) ? (s.refs as { url?: string; label?: LocaleText }[]) : []))
  const refUrls = refs.map((r) => r?.url).filter(Boolean) as string[]
  const refLabels = refs.map((r) => flat(r?.label)).filter(Boolean)
  // Полный текст шага для модерации: заголовок/описание/команда + why/section/subtasks
  // + ВСЕ строки контент-блока (steps.content). Так классификатор видит и rich-блоки.
  const stepBody = (s: (typeof stepRows)[number], i: number) =>
    `${i + 1}. ` +
    [flat(s.title), flat(s.desc), s.command, ...contentStrings(s.why), ...contentStrings(s.section), ...contentStrings(s.subtasks), ...contentStrings(s.content)]
      .filter(Boolean)
      .join(' ')
  const text = [flat(tpl.title), flat(tpl.desc), ...refUrls, ...refLabels, ...stepRows.map(stepBody)]
    .filter(Boolean)
    .join('\n')
  return {
    signals: { title: flat(tpl.title), stepCount: stepRows.length, text },
    stepTitles: stepRows.map((s) => flat(s.title)),
    ownerId: tpl.ownerId,
    moderation: tpl.moderation,
  }
}

/** Текст списка для ручной ИИ-проверки из админки. */
export async function buildListText(templateId: string): Promise<string> {
  return (await loadListSignals(templateId))?.signals.text ?? ''
}

export function verdictReason(v: ModerationVerdict): string {
  return `AI [${v.category || '—'}]: ${v.reason}`
}

/** Нарушитель: уже имеет flagged/hidden списки (кроме проверяемого). Ему не
 *  положен fail-open — при недоступном ИИ его публикация ждёт человека. */
async function isOffenderAuthor(ownerId: string, exceptTemplateId: string): Promise<boolean> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .where(
      and(
        eq(templates.ownerId, ownerId),
        ne(templates.id, exceptTemplateId),
        inArray(templates.moderation, ['flagged', 'hidden']),
      ),
    )
  return (r?.n ?? 0) > 0
}

/** Постановка moderate-джобы с дедупом (одна невыполненная на список — она всё
 *  равно проверит последнюю версию) и суточным капом LLM-вызовов на автора. */
async function enqueueModerate(templateId: string, gate: boolean, ownerId: string): Promise<'queued' | 'dup' | 'capped'> {
  const [dup] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(eq(jobs.type, 'moderate'), inArray(jobs.status, ['pending', 'processing']), sql`${jobs.payload}->>'templateId' = ${templateId}`),
    )
    .limit(1)
  if (dup) return 'dup'
  // Кап считаем по ownerId, зашитому в payload джобы, а НЕ join'ом на templates:
  // цикл publish→delete→publish удалял шаблон, join терял его джобы и кап
  // обнулялся. Джоба переживает удаление шаблона — счёт честный.
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.type, 'moderate'), sql`${jobs.payload}->>'ownerId' = ${ownerId}`, sql`${jobs.createdAt} > now() - interval '24 hours'`))
  if ((c?.n ?? 0) >= MODERATE_DAILY_CAP) return 'capped'
  await enqueueJob('moderate', { templateId, gate, ownerId })
  return 'queued'
}

/** Отпустить удержание: только `pending` → `active`. Снятое админом (flagged/hidden) под
 *  это условие не подпадает и остаётся снятым. */
async function releaseHold(templateId: string): Promise<void> {
  await db
    .update(templates)
    .set({ moderation: 'active', moderationReason: null, moderationSeverity: 0 })
    .where(and(eq(templates.id, templateId), eq(templates.moderation, 'pending')))
}

/** Кап расхода исчерпан: список, ждущий проверку, остаётся pending — но с внятной
 *  причиной, иначе в очереди модерации он выглядит просто «висящим». Пометка нужна
 *  ОБОИМ путям: и публикации существующего списка, и созданию нового (там состояние
 *  решено до записи, а джобу ставит барьер фасада — см. recheckList). */
async function markCapped(templateId: string): Promise<void> {
  await db
    .update(templates)
    .set({ moderationReason: 'publication rate limit — awaiting manual review', moderationSeverity: 1 })
    .where(and(eq(templates.id, templateId), eq(templates.moderation, 'pending')))
}

/**
 * Гейт публикации УЖЕ СУЩЕСТВУЮЩЕГО списка (модель YouTube): публикация черновика,
 * открытие приватного, автономная публикация петлёй. Список уходит в pending — не
 * виден никому, кроме владельца/админа, — и встаёт в очередь на авто-проверку.
 * Доверенные авторы публикуются сразу (пере-проверка фоном). Без настроенного
 * ИИ-ключа гейт выключен: список остаётся active (dev/стенды).
 *
 * НОВЫЙ список сюда не приходит: его состояние решает то же правило
 * (`initialModeration`) ДО записи, и в ядро оно уезжает значением вставки —
 * иначе между insert и этим апдейтом список недоверенного автора публичен.
 */
export async function gateListPublication(templateId: string, opts: { preHeld?: boolean } = {}): Promise<void> {
  // Успел ли барьер сам решить «держим». От этого зависит, что делать при сбое ниже:
  // решение состоялось — удержание законно и остаётся даже без очереди; не состоялось —
  // держать нечем, и заранее выставленное вызывающим удержание надо снять.
  let decided = false
  try {
    const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
    if (!tpl) return
    // flagged/hidden не «отмываются» переключением видимости/повторной публикацией —
    // их судьбу решает только админ (апелляция или очередь).
    if (tpl.moderation === 'flagged' || tpl.moderation === 'hidden') return
    // Решение — общее с путём создания (shared/moderation/publication-state):
    // копия правила в двух путях публикации разъезжается, и одна из веток начинает
    // пускать непроверенное в паблик.
    const decision = await publicationDecision(tpl.ownerId, templateId)
    // Снимаем удержание, если проверка не нужна. Вызывающий вправе выставить `pending` ДО
    // того, как список стал видимым (так делает пакетная публикация: иначе между «уже
    // опубликован» и «барьер решил» список открыт всем). Тогда именно барьер обязан
    // удержание отпустить — а `where moderation = 'pending'` следит, чтобы этим нельзя было
    // отмыть flagged/hidden, даже если проверки выше однажды переставят.
    if (decision === 'gate-off') {
      await releaseHold(templateId)
      return
    }
    if (decision === 'trusted') {
      await releaseHold(templateId)
      await enqueueModerate(templateId, false, tpl.ownerId)
      return
    }
    const [held] = await db
      .update(templates)
      .set({ moderation: 'pending', moderationReason: null, moderationSeverity: 0 })
      // Решение админа не затираем ни при каком раскладе.
      //
      // Обычный вход (кнопка, смена видимости) удержание СТАВИТ, поэтому пишет, только если
      // состояние осталось тем, которое гейт видел.
      //
      // Вход с `preHeld` (пакетная публикация) удержание уже поставил ДО нас, и наша задача
      // — не поднять его заново, а лишь подтвердить. Тут мало сравнения со снимком: админ
      // успевает одобрить список и до того, как гейт прочитал строку, — тогда снимок сам
      // окажется `active`, сравнение сойдётся, и одобрение уедет обратно в очередь (находка
      // авто-ревью). Поэтому условие жёстче: держим только то, что уже удержано.
      .where(and(eq(templates.id, templateId), opts.preHeld ? eq(templates.moderation, 'pending') : eq(templates.moderation, tpl.moderation)))
      .returning({ id: templates.id })
    decided = true
    // Удержание не наше — значит и проверку ставить не за чем. Джоба с `gate: true` считает
    // себя хозяйкой вердикта и позже перекрыла бы одобрение админа своим (находка
    // авто-ревью): решение человека сильнее не только этой записи, но и всей очереди.
    if (!held) return
    if ((await enqueueModerate(templateId, true, tpl.ownerId)) === 'capped') await markCapped(templateId)
  } catch (e) {
    captureError(e, { where: 'moderation.gate', templateId })
    // Гейт не должен ронять публикацию. Вызывающий вправе поставить удержание ЗАРАНЕЕ
    // (пакетная публикация так и делает, чтобы список не побыл видимым до решения), и если
    // решение НЕ состоялось — снимаем: иначе сбой проверки навсегда прячет опубликованный
    // список, а очередь модерации о нём не знает (находка авто-ревью).
    //
    // А вот когда решение состоялось и упала только постановка в очередь, удержание
    // законно: список действительно не проверен, и снимать его нельзя — это давнее
    // поведение, за ним следит отдельный тест про счёт доверия.
    if (!decided) await releaseHold(templateId).catch(() => {})
  }
}

/**
 * Пере-проверка УЖЕ видимого списка после правки (новая версия / merge / принятая
 * правка / git push). Список остаётся видимым, проверка идёт в фоне; нарушение → flagged.
 */
export async function recheckList(templateId: string): Promise<void> {
  try {
    const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
    if (!tpl) return
    // Самозащита по видимости: приватный список наружу не выставлен — модерировать
    // нечего (и не жжём LLM). Раньше это был внешний `if (public)` на КАЖДОМ месте
    // вызова; теперь гейт внутри → recheckList безопасно звать безусловно (в т.ч. из
    // фасада listStore.addVersion — единой точки, которую нельзя забыть).
    if (tpl.visibility !== 'public') return
    // Правка контента снимает флаг поданной апелляции: владелец изменил список и
    // вправе подать новую (иначе после отказа админа, который не сбрасывает appealedAt,
    // он оставался бы заблокирован навсегда). Дешёвый апдейт только когда флаг стоит.
    await db
      .update(templates)
      .set({ appealedAt: null })
      .where(and(eq(templates.id, templateId), sql`${templates.appealedAt} is not null`))
    if (!(await getApiKey())) return
    // Список, РОЖДЁННЫЙ pending (недоверенный автор — состояние решено до записи),
    // приходит сюда как единственный барьер очереди: джоба ставится тем же вызовом,
    // а исчерпанный кап обязан оставить причину — иначе он висит в очереди модерации
    // без объяснения. Для уже видимого списка (обычная пере-проверка) ветка молчит:
    // markCapped пишет только в строку, которая ждёт проверку.
    if ((await enqueueModerate(templateId, false, tpl.ownerId)) === 'capped') await markCapped(templateId)
  } catch (e) {
    captureError(e, { where: 'moderation.recheck', templateId })
  }
}

export interface ModerateJobPayload {
  templateId: string
  gate: boolean // true — решаем судьбу pending-списка; false — фоновая пере-проверка видимого
  ownerId?: string // автор — для суточного капа LLM-проверок (см. enqueueModerate)
}

/** Флаг с защитой от гонки: не перетираем свежее ручное решение админа (hidden
 *  или уже одобренный им flagged→active обрабатываются только из pending/active). */
async function setFlagged(templateId: string, reason: string, severity: number): Promise<void> {
  await db
    .update(templates)
    .set({ moderation: 'flagged', moderationReason: reason, moderationSeverity: severity })
    .where(and(eq(templates.id, templateId), inArray(templates.moderation, ['pending', 'active'])))
}

/** Одобрение строго из pending — не перетираем ручное решение админа,
 *  случившееся между постановкой джобы и её выполнением. */
async function approvePending(templateId: string, note: string | null): Promise<void> {
  await db
    .update(templates)
    .set({ moderation: 'active', moderationReason: note, moderationSeverity: 0 })
    .where(and(eq(templates.id, templateId), eq(templates.moderation, 'pending')))
}

/**
 * Джоб-логика авто-проверки, ярусами (как у больших платформ):
 * 1) спам-эвристики — 0 токенов (только на гейте: живой список эвристикой не роняем);
 * 2) отпечаток — повторная заливка удалённого; 3) ИИ-классификатор с порогами
 * уверенности: уверенно-safe → active, уверенно-unsafe → flagged, серая зона →
 * остаётся pending для человека. ИИ недоступен → ретраи; на последней попытке
 * fail-open (кроме нарушителей).
 */
export async function runModerateJob(payload: unknown, attempt: { attempts: number; maxAttempts: number }): Promise<void> {
  const p = payload as ModerateJobPayload
  const loaded = await loadListSignals(p.templateId)
  if (!loaded) return // список удалён — нечего проверять
  // Эффективный гейт: правка владельцем hold-списка (pending) должна уметь
  // одобрить его — иначе исправленный список застревает в pending навсегда.
  const gate = p.gate || loaded.moderation === 'pending'

  if (gate) {
    // Домены из партнёрских правил админки — доверенные магазины: корзина
    // («Shop this list») не должна флажиться как link farm.
    const { getMonetizationSettings } = await import('@/shared/settings/monetization')
    const allowedHosts = (await getMonetizationSettings()).affiliateRules.map((r) => r.match)
    const h = checkSpamHeuristics(loaded.signals, allowedHosts)
    if (h.spam) {
      await setFlagged(p.templateId, h.reason, 2)
      return
    }
  }

  const body = fingerprintBody(loaded.signals.title, loaded.stepTitles)
  const fp = body.length >= MIN_FINGERPRINT_BODY ? contentFingerprint(loaded.signals.title, loaded.stepTitles) : null
  await db.update(templates).set({ contentFingerprint: fp }).where(eq(templates.id, p.templateId))
  if (fp) {
    // Родословную (forked_from) НЕ исключаем сознательно: иначе self-fork
    // flagged-списка отмывал бы удалённый контент. Невиновный форк, чей
    // оригинал сняли позже, попадёт к человеку с внятной причиной — приемлемо.
    const [dup] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(
        and(eq(templates.contentFingerprint, fp), ne(templates.id, p.templateId), inArray(templates.moderation, ['flagged', 'hidden'])),
      )
      .limit(1)
    if (dup) {
      await setFlagged(p.templateId, 'Re-upload of previously removed content', 3)
      return
    }
  }

  // Глобальный дневной кап расхода исчерпан → не тратим LLM. Гейт: список остаётся
  // pending (не публичен) с пометкой для человека; пере-проверка видимого — просто
  // откладывается (список уже был одобрен ранее, ничего не меняем).
  if (!(await globalBudgetOk())) {
    if (gate)
      await db
        .update(templates)
        .set({ moderationReason: 'AI budget exhausted — awaiting manual review', moderationSeverity: 1 })
        .where(and(eq(templates.id, p.templateId), eq(templates.moderation, 'pending')))
    return
  }

  const verdict = await moderateContent(loaded.signals.text, { refId: p.templateId })
  if (!verdict) {
    if (attempt.attempts >= attempt.maxAttempts) {
      if (!gate) return
      if (await isOffenderAuthor(loaded.ownerId, p.templateId)) {
        // нарушителю fail-open не положен: остаётся pending до человека
        await db
          .update(templates)
          .set({ moderationReason: 'AI unavailable — awaiting manual review', moderationSeverity: 1 })
          .where(and(eq(templates.id, p.templateId), eq(templates.moderation, 'pending')))
        return
      }
      await approvePending(p.templateId, 'auto-approved: AI unavailable')
      return
    }
    throw new Error('moderation AI unavailable')
  }

  const route = routeVerdict(verdict, gate)
  if (route.action === 'flag') await setFlagged(p.templateId, route.reason, route.severity)
  else if (route.action === 'approve') await approvePending(p.templateId, null)
  else if (route.action === 'hold')
    await db
      .update(templates)
      .set({ moderationReason: route.reason, moderationSeverity: route.severity })
      .where(and(eq(templates.id, p.templateId), eq(templates.moderation, 'pending')))
  // 'none' — пере-проверка видимого без нарушений: ничего не делаем
}

/** На старте воркера: отпечатки для ранее flagged/hidden списков — без них
 *  повторную заливку удалённого не поймать. Идемпотентно, батчами до исчерпания. */
export async function ensureModerationFingerprints(): Promise<void> {
  for (let batch = 0; batch < 20; batch++) {
    const rows = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(inArray(templates.moderation, ['flagged', 'hidden']), sql`${templates.contentFingerprint} is null`))
      .limit(200)
    for (const r of rows) {
      const loaded = await loadListSignals(r.id)
      if (!loaded) continue
      const body = fingerprintBody(loaded.signals.title, loaded.stepTitles)
      await db
        .update(templates)
        // вырожденное тело помечаем пустой строкой (не null) — чтобы батч не крутился на них вечно
        .set({ contentFingerprint: body.length >= MIN_FINGERPRINT_BODY ? contentFingerprint(loaded.signals.title, loaded.stepTitles) : '' })
        .where(eq(templates.id, r.id))
    }
    if (rows.length < 200) break
  }
}

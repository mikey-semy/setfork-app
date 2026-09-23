import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db, digGuides } from '@/shared/db'
import { decide, decideModel } from '@/shared/ai/decide'
import { fitsQuestion, guideAbout, guideQuestion, guideState, type GuideCandidate } from '@/shared/ai/guide-question'
import type { Expert } from '@/shared/ai/roster'

/**
 * КТО ПОВЕДЁТ ПО ЭТОМУ ПУНКТУ — решает Jev, а не совпадение тегов СПИСКА.
 *
 * Прежнее правило (`pickExpert`) смотрело на теги списка, поэтому у всех пунктов одного
 * списка проводник был один: `pg_stat_statements` в списке «медленное API» вёл DevOps, а
 * разборы Commitics почти целиком уходили универсалу. На наборе из 57 пунктов оно
 * попадает в допустимого мастера в 28 случаях, Jev — в 57 (замер
 * `scripts/gnome-routing-eval.ts`, PR #961; решение владельца встроить — 23.09.2026).
 *
 * Правила встраивания:
 *  • `null` — не проводник, а сигнал взять запасное правило: сбой модели, исчерпанный
 *    бюджет, неразобранный ответ. Вызывающий обязан его иметь (`pickExpert`);
 *  • порога уверенности НЕТ: набор замера упёрся в потолок (ни одного промаха), и
 *    откалибровать порог было не на чем. Решения и уверенность копятся в `dig_guides`,
 *    порог подберут по ним;
 *  • один вопрос на пункт версии и отпечаток вопроса — ответ кэшируется в `dig_guides`;
 *  • вопрос «подходит ли пункт ремеслу выбранного» задаётся в ТЕНИ (`fits`): пишется, ни
 *    на что не влияет.
 */

const candidateOf = (e: Expert): GuideCandidate => ({ id: e.id, about: guideAbout(e.persona), domains: e.domains })

export interface GuideItem {
  templateId: string
  version: number
  stepN: number
  listTitle: string
  tags: string[]
  section?: string | null
  /** Текст пункта на языке читателя: заголовок, пояснение, markdown текст-блока. */
  item: string
  /** Язык читателя — часть ключа решения: вопрос строится на нём. */
  lang: string
  userId: string
}

export interface ItemGuide {
  expert: Expert
  /**
   * Теневой вопрос о ремесле. Вызывающий дожидается его, пока гном отвечает, — задержки
   * это не добавляет, а незавершённая запись не теряется вместе с запросом.
   */
  shadow: Promise<void>
}

const done: Promise<void> = Promise.resolve()

/**
 * Отпечаток ВОПРОСА — всё, от чего зависит решение: модель, кандидаты и само состояние
 * пункта. Решение годно, пока он тот же. Поправил админ персону или домены, включил нового
 * мастера, сменилась модель — переспрашиваем; переименовал владелец список или сменил теги
 * (`updateListMeta` делает это без новой версии) — тоже (два замечания авто-ревью к #964).
 */
function questionFingerprint(model: string, q: ReturnType<typeof guideQuestion>, state: string): string {
  return createHash('sha256').update(JSON.stringify({ model, instructions: q.instructions, criteria: q.criteria, state })).digest('hex').slice(0, 16)
}

export async function guideForItem(it: GuideItem, roster: Expert[]): Promise<ItemGuide | null> {
  const where = and(
    eq(digGuides.templateId, it.templateId),
    eq(digGuides.version, it.version),
    eq(digGuides.stepN, it.stepN),
    eq(digGuides.lang, it.lang),
  )
  const question = guideQuestion(roster.map(candidateOf))
  const state = guideState({ listTitle: it.listTitle, tags: it.tags, section: it.section, item: it.item })
  const fingerprint = questionFingerprint(await decideModel(), question, state)
  const ref = { refType: 'template', refId: it.templateId, userId: it.userId }

  /**
   * Теневой вопрос о ремесле — только своему мастеру и только в пустое поле: строку могли
   * перевыбрать, пока шёл вопрос. Не удался (таймаут, бюджет, мусор) — поле остаётся пустым
   * и вопрос повторяется при следующем визите, иначе образец калибровки пропал бы навсегда
   * (авто-ревью к #964).
   */
  const askFits = (expert: Expert): Promise<void> =>
    (async () => {
      const f = await decide({ state, questions: { fits: fitsQuestion(candidateOf(expert)) }, ...ref })
      const n = f?.answers.fits
      if (n?.type === 'noul') {
        await db
          .update(digGuides)
          .set({ fits: n.noul })
          // И тот же ВОПРОС: мастер мог остаться прежним, а состояние или персона — смениться,
          // и тогда ответ, посчитанный для старого вопроса, лёг бы к новому (авто-ревью к #964).
          .where(and(where, eq(digGuides.gnomeId, expert.id), eq(digGuides.fingerprint, fingerprint), isNull(digGuides.fits)))
      }
    })().catch((e) => console.warn('[dig-guide] теневой вопрос о ремесле не записан', e instanceof Error ? e.message : e))

  const [cached] = await db
    .select({ gnomeId: digGuides.gnomeId, fits: digGuides.fits, fingerprint: digGuides.fingerprint })
    .from(digGuides)
    .where(where)
    .limit(1)
  // Годно, пока вопрос тот же и выбранный не выключен в админке.
  const hit = cached && cached.fingerprint === fingerprint ? roster.find((e) => e.id === cached.gnomeId) : undefined
  if (hit) return { expert: hit, shadow: cached.fits === null ? askFits(hit) : done }

  // Выбирать не из кого — спрашивать модель незачем.
  if (Object.keys(question.criteria).length < 2) return null

  const r = await decide({ state, questions: { guide: question }, ...ref })
  const a = r?.answers.guide
  if (!r || a?.type !== 'choice') return null
  const expert = roster.find((e) => e.id === a.choice)
  if (!expert) return null

  // ⚠️ ГОНКА ДВУХ ПЕРВЫХ ВОПРОСОВ. Оба прошли мимо пустого кэша и спросили модель сами;
  // перезапиши второй первого — пропал бы `fits` победителя, а теневой ответ одного мастера
  // лёг бы к другому, и выборка калибровки испортилась бы молча (авто-ревью к #964).
  // Поэтому строка пишется только если её ещё нет, а замена устаревшей — только если в
  // строке всё ещё прежнее решение; проигравший берёт победителя и тень не задаёт.
  const row = { gnomeId: expert.id, confidence: a.confidence, probabilities: a.probabilities, model: r.model, fingerprint, fits: null }
  const written = cached
    ? await db
        .update(digGuides)
        .set(row)
        .where(and(where, eq(digGuides.gnomeId, cached.gnomeId), eq(digGuides.fingerprint, cached.fingerprint)))
        .returning({ gnomeId: digGuides.gnomeId })
    : await db
        .insert(digGuides)
        .values({ templateId: it.templateId, version: it.version, stepN: it.stepN, lang: it.lang, ...row })
        .onConflictDoNothing()
        .returning({ gnomeId: digGuides.gnomeId })
  if (!written.length) {
    const [winner] = await db
      .select({ gnomeId: digGuides.gnomeId, fingerprint: digGuides.fingerprint })
      .from(digGuides)
      .where(where)
      .limit(1)
    // Победитель отвечал на ТОТ ЖЕ вопрос — берём его. На другой (состояние или ростер
    // сменились между чтениями) — его решение для нашего вопроса устарело: пробуем один раз
    // заменить его своим, сравнением с тем, что прочли (авто-ревью к #964). Не вышло и тут —
    // отдаём своё решение без записи: кэш поправит следующий визит, а спрашивать модель
    // по кругу ради записи незачем.
    if (winner && winner.fingerprint === fingerprint) {
      const won = roster.find((e) => e.id === winner.gnomeId)
      return won ? { expert: won, shadow: done } : null
    }
    const replaced = winner
      ? await db
          .update(digGuides)
          .set(row)
          .where(and(where, eq(digGuides.gnomeId, winner.gnomeId), eq(digGuides.fingerprint, winner.fingerprint)))
          .returning({ gnomeId: digGuides.gnomeId })
      : []
    return { expert, shadow: replaced.length ? askFits(expert) : done }
  }

  return { expert, shadow: askFits(expert) }
}

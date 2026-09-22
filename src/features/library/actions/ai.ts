'use server'

import { asc, eq, lt } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, steps, templates, users, type ProposedItem, type StepLevel } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { isLang, langEnName, trKey, type Lang, type LocaleText } from '@/shared/i18n'
import { generateBlockRefine, generateChangeNote, generateListRefine, generateListTranslation, generateTextTranslation } from '@/shared/ai/generate'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { fetchPublicUrl } from '@/shared/lib/safe-fetch'
import { aiQuota } from '@/shared/quota'
import { textLang } from '@/shared/i18n/detect-text-lang'
import { toStepInput } from '@/shared/lib/step-input'
import { canEditList, canViewList, ListWriteError } from '@/core'
import { isCollaborator } from '@/features/collab/queries'
import { addBlockTranslation, blockText } from '../blocks'
import { hasLang } from '../translation-state'
import { emptyItem, parseEditorItems, toProposedItems, type EditorBlockPatch, type EditorItem } from '../editor'
import { listStore } from '../list-store'
import { hasChanges, summarizeDiffForNote } from '../change-summary'
import { diffSteps, rowsToCmp } from '../diff'
import { notifyWatchersNewVersion } from '../suggestion-side-effects'
import { botUserAgent } from '@/shared/site'

/**
 * ИИ поверх списка: доработка пунктов по инструкции, перевод на другой язык,
 * примечание к версии из диффа и заголовок ссылки со страницы.
 *
 * Отдельно от остальных экшенов: у этой четвёрки одна причина меняться — модель,
 * лимиты и квоты, — и только они ходят в `shared/ai`.
 */

// ── AI-refine: правка пунктов редактора по инструкции ────────────────
export async function refineList(input: {
  items: EditorItem[]
  title: string
  desc: string
  tags: string[]
  instruction: string
}): Promise<{ items: EditorItem[] } | { error: string }> {
  const session = await requireSession()
  const lang = await getLang()
  const instruction = String(input.instruction ?? '').trim()
  if (!instruction) return { error: 'empty' }

  const { allowed } = await checkRateLimit(`refine:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  const current = {
    title: input.title || '',
    desc: input.desc || '',
    tags: input.tags || [],
    items: (input.items || [])
      .filter((it) => it.title?.trim())
      .map((it) => ({
        title: it.title,
        desc: it.desc,
        command: it.command,
        level: it.level ?? 'required',
        why: it.why ?? '',
        subtasks: (it.subtasks || []).filter((s) => s.trim()),
        refs: (it.refs || []).filter((r) => r.label?.trim() && r.url?.trim()).map((r) => ({ label: r.label, url: r.url })),
      })),
  }
  // Язык рефайна = язык СОДЕРЖИМОГО списка, не интерфейса: русский список при
  // en-интерфейсе иначе «улучшался» переводом. Пустой черновик → язык интерфейса.
  const contentLang = current.title || current.items.length
    ? textLang([current.title, current.desc, ...current.items.flatMap((it) => [it.title, it.desc])])
    : lang
  const refined = await generateListRefine(current, instruction, contentLang, { userId: session.userId, feature: 'refine' })
  if (!refined) return { error: 'aifail' }

  // Refine переписывает текстовое содержимое шагов; скриншоты не переносятся, ссылки — да.
  // Форма блока — от ОБЩЕГО конструктора (emptyItem), а не выписанная здесь
  // повторно: иначе каждое новое поле блока надо помнить дописать и сюда.
  const items: EditorItem[] = refined.items.map((it) => ({
    ...emptyItem(),
    title: it.title,
    desc: it.desc,
    command: it.command,
    level: it.level,
    why: it.why,
    needsHuman: it.needsHuman === true,
    needsHumanAsk: it.needsHumanAsk ?? '',
    subtasks: it.subtasks,
    refs: (it.refs ?? []).map((r) => ({ label: r.label, url: r.url })),
  }))
  return { items }
}

/**
 * Правка ОДНОГО блока по инструкции из чата (кнопка в углу карточки).
 *
 * Отличие от refineList не только в объёме: тот переписывает весь состав и стирает
 * скриншоты, поэтому его нельзя звать «на всякий случай». Здесь человек правит
 * конкретный блок и видит, что именно предлагается, — применить или нет, решает он.
 *
 * Возвращаем ПОЛЯ, а не готовый EditorItem: блок в редакторе живёт со своим id,
 * загруженной картинкой и голосами опроса — их правка текста трогать не должна.
 */
export async function refineBlock(input: {
  block: { title: string; desc: string; command: string; level: StepLevel; why: string; subtasks: string[]; refs: { label: string; url: string }[] }
  instruction: string
  context: { title: string; desc: string }
}): Promise<{ block: EditorBlockPatch } | { error: string }> {
  const session = await requireSession()
  const lang = await getLang()
  const instruction = String(input.instruction ?? '').trim()
  if (!instruction) return { error: 'empty' }

  const { allowed } = await checkRateLimit(`refine:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  // Язык правки — язык СОДЕРЖИМОГО блока, не интерфейса: русский пункт при
  // en-интерфейсе иначе «улучшался» переводом (та же причина, что у refineList).
  const contentLang = input.block.title || input.block.desc ? textLang([input.block.title, input.block.desc]) : lang
  const refined = await generateBlockRefine(
    {
      title: input.block.title,
      desc: input.block.desc,
      command: input.block.command,
      level: input.block.level,
      why: input.block.why,
      subtasks: (input.block.subtasks || []).filter((x) => x.trim()),
      refs: (input.block.refs || []).filter((r) => r.label?.trim() && r.url?.trim()),
    },
    instruction,
    { title: input.context.title || '', desc: input.context.desc || '' },
    contentLang,
    { userId: session.userId, feature: 'refine' },
  )
  if (!refined) return { error: 'aifail' }

  return {
    block: {
      title: refined.title,
      desc: refined.desc,
      command: refined.command,
      level: refined.level,
      why: refined.why,
      needsHuman: refined.needsHuman === true,
      needsHumanAsk: refined.needsHumanAsk ?? '',
      subtasks: refined.subtasks,
      refs: (refined.refs ?? []).map((r) => ({ label: r.label, url: r.url })),
    },
  }
}

// ── AI-перевод списка: добавить язык, не трогая оригинал (ADR-0009) ───
export async function translateList(templateId: string, targetLang: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession()
  if (!isLang(targetLang)) return { error: 'badlang' }
  const tpl = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!tpl) return { error: 'notfound' }
  // Перевод = правка контента: владелец или коллаборатор (как saveNewVersion).
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return { error: 'forbidden' }
  // Архив/заморозка: раньше это ловил только фасадный бэкстоп addVersion, но мета
  // теперь обновляется ДО версии — гейтим явно, чтобы замороженный список не
  // получил переведённые title/desc без версии.
  if (!canEditList(tpl)) return { error: 'forbidden' }

  const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  if (!cur) return { error: 'notfound' }
  const rows = await db.query.steps.findMany({ where: (s) => eq(s.versionId, cur.id), orderBy: (s, { asc }) => asc(s.n) })

  // Перевод УЖЕ ЕСТЬ — берём из памяти, модель не зовём и версию не плодим.
  //
  // Показ и так идёт через tr(): раз ключ языка лежит в данных, читатель видит
  // перевод без всякой нейросети. Кнопка нужна только чтобы создать
  // недостающее — а нажатая второй раз она тратила бы и квоту, и деньги, и
  // заводила версию, в которой ничего не изменилось.
  if (hasLang(tpl, rows, targetLang)) return { ok: true }

  const { allowed } = await checkRateLimit(`translate:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  // Исходный текст поля: значение на любом уже имеющемся языке (en → первый).
  const pick = (lt: LocaleText | null | undefined): string => (lt ? (lt.en ?? Object.values(lt).find(Boolean) ?? '') : '')
  // Проекция блока в то, ЧТО УВИДИТ МОДЕЛЬ. Отдельной функцией, потому что по ней же
  // потом сверяется, тот ли это текст: см. слияние ниже.
  type TranslatableStep = (typeof rows)[number]
  const srcOf = (s: TranslatableStep) => ({
    title: pick(s.title),
    desc: pick(s.desc),
    command: s.command,
    level: s.level,
    why: pick(s.why),
    subtasks: (s.subtasks as LocaleText[]).map(pick),
    refs: (s.refs as { label: LocaleText; url?: string }[]).map((r) => ({ label: pick(r.label), url: r.url ?? '' })),
  })
  const mdOf = (s: TranslatableStep): string => (s.type === 'text' ? blockText((s.content as { md?: unknown } | null)?.md) : '')
  /** Отпечаток исходника блока — всё, что уехало в модель, включая врезку. */
  const srcKey = (s: TranslatableStep): string => JSON.stringify([srcOf(s), mdOf(s)])
  const current = { title: pick(tpl.title), desc: pick(tpl.desc), items: rows.map(srcOf) }

  // Markdown-врезки переводятся отдельным вызовом: их нет в форме шага, и
  // проза внутри большого JSON у модели разъезжается — списки, таблицы,
  // переносы. См. generateTextTranslation.
  const mdIdx: number[] = []
  const mdChunks: string[] = []
  rows.forEach((s, i) => {
    const md = mdOf(s)
    if (md.trim()) {
      mdIdx.push(i)
      mdChunks.push(md)
    }
  })

  const [translated, mdOut] = await Promise.all([
    generateListTranslation(current, targetLang, { userId: session.userId, feature: 'translate' }),
    generateTextTranslation(mdChunks, targetLang, { userId: session.userId, feature: 'translate' }),
  ])
  if (!translated) return { error: 'aifail' }
  // ВСЁ ИЛИ НИЧЕГО. Сохранить половину выглядит соблазнительно («врезки доберём
  // потом»), но добирать было бы нечем: кнопка исчезает, как только у заголовка
  // появился ключ языка, — и врезки остались бы на чужом языке навсегда. Отказ
  // целиком человек видит тостом и жмёт ещё раз.
  if (mdChunks.length && !mdOut) return { error: 'aifail' }
  const mdByIndex = new Map<number, string>()
  if (mdOut) mdIdx.forEach((rowIndex, k) => mdByIndex.set(rowIndex, mdOut[k] ?? ''))

  // Язык оригинала — тот, из которого tr() читает заголовок: врезки писались
  // вместе с ним. Нужен, чтобы старую одноязычную строку положить под верный
  // ключ, а не потерять её при добавлении перевода.
  const sourceLang: Lang = (trKey(tpl.title, 'en') as Lang | undefined) ?? 'en'
  // Модель обязана сохранить порядок и число шагов — иначе мёрж по индексу уедет.
  if (translated.items.length !== rows.length) return { error: 'mismatch' }

  // Добавить ключ targetLang к LocaleText, СОХРАНИВ существующие языки.
  const add = (lt: LocaleText | null | undefined, val: string): LocaleText => {
    const base = (lt ?? {}) as LocaleText
    return val.trim() ? { ...base, [targetLang]: val.trim() } : base
  }
  /**
   * ПОЛЕ ДЕЙСТВИТЕЛЬНО ПОЛУЧИЛО ПЕРЕВОД — а не «было к чему приложить».
   *
   * Считать надо именно это. Совпавший блок с пустым ответом модели переводом не стал,
   * и версия из одних таких блоков не несла бы ничего, зато сдвинула бы историю,
   * разбудила наблюдателей и списала платный вызов.
   */
  const gotLang = (src: LocaleText | null | undefined, out: LocaleText): boolean =>
    Boolean(out[targetLang]?.trim()) && !((src ?? {}) as LocaleText)[targetLang]?.trim()

  /**
   * СЛИЯНИЕ, А НЕ ОТКАЗ — решение по этому маршруту.
   *
   * Между чтением `rows` и этой строкой стоят ДВА вызова модели: человек нажал
   * «Перевести» и ждёт у экрана десятки секунд. Если за это время соавтор опубликовал
   * свою версию, отвергнуть перевод значит выбросить и минуту человека, и оплаченный
   * вызов — за чужое действие. Поэтому перевод накладывается на СВЕЖИЙ состав:
   *
   *  • блок ищется по своему `blockId` (идентичность переживает версии, ADR-0013), а у
   *    старых списков, где его нет, — по отпечатку собственного исходника;
   *  • перевод ставится, только если исходник блока НЕ ИЗМЕНИЛСЯ — иначе перевод
   *    относился бы к тексту, которого больше нет, и врал бы читателю уверенно;
   *  • блок, которого модель не видела (добавлен соседом), остаётся без ключа языка —
   *    а `hasLang` считает список переведённым только целиком, поэтому кнопка не
   *    исчезает и недостающее дозаполняется следующим нажатием.
   *
   * Перезаписать чужую версию нельзя, потерять работу человека — тоже; слияние
   * выполняет оба условия, а отказ остаётся только на случай, когда переводить в
   * свежем составе оказалось вообще нечего.
   */
  const after = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  const head = after?.versions.find((v) => v.version === after.currentVersion)
  if (!after || !head) return { error: 'notfound' }
  // Список не сдвинулся — те же строки, второго запроса не делаем.
  const target =
    head.id === cur.id
      ? rows
      : await db.query.steps.findMany({ where: (s) => eq(s.versionId, head.id), orderBy: (s, { asc: a }) => a(s.n) })

  // ЧЕМ ИЩЕМ БЛОК В СВЕЖЕМ СОСТАВЕ. Основной ключ — `blockId`. У старых списков его
  // может не быть вовсе (`steps.block_id` в схеме nullable), и запасным ключом стояла
  // ПОЗИЦИЯ — а она сдвигается от любой вставки соседа, и тогда слияние обнулялось
  // целиком: ни один блок не находил своего перевода. Запасной ключ теперь — отпечаток
  // самого исходника: он не зависит от места, а совпадение двух одинаковых блоков
  // безвредно, перевод у них всё равно один.
  const perBlock = rows.map((s, i) => ({ src: srcKey(s), t: translated.items[i], md: mdByIndex.get(i) }))
  const byBid = new Map(rows.flatMap((s, i) => (s.blockId ? [[s.blockId, perBlock[i]] as const] : [])))
  const bySrc = new Map(rows.flatMap((s, i) => (s.blockId ? [] : [[perBlock[i].src, perBlock[i]] as const])))

  let applied = 0
  const proposed: ProposedItem[] = target.map((s) => {
    const key = srcKey(s)
    const hit = s.blockId ? byBid.get(s.blockId) : bySrc.get(key)
    // Перевод ставится, только если исходник блока НЕ ИЗМЕНИЛСЯ: иначе он относился бы
    // к тексту, которого больше нет, и врал бы читателю уверенно.
    const same = hit?.src === key
    const t = same ? hit?.t : undefined
    const md = same ? hit?.md : undefined
    const subs = s.subtasks as LocaleText[]
    const refs = s.refs as { label: LocaleText; url?: string }[]
    const title = add(s.title, t?.title ?? '')
    const descOut = add(s.desc, t?.desc ?? '')
    const why = add(s.why, t?.why ?? '')
    const subtasks = subs.map((st, k) => add(st, t?.subtasks[k] ?? ''))
    const refsOut = refs.map((r, k) => ({ label: add(r.label, t?.refs[k]?.label ?? ''), ...(r.url ? { url: r.url } : {}) }))
    const gotMd = s.type === 'text' && Boolean(md?.trim())
    // Считаем ПЕРЕВЕДЁННЫЕ блоки, а не совпавшие.
    if (
      gotMd ||
      gotLang(s.title, title) ||
      gotLang(s.desc, descOut) ||
      gotLang(s.why, why) ||
      subtasks.some((x, k) => gotLang(subs[k], x)) ||
      refsOut.some((r, k) => gotLang(refs[k].label, r.label))
    )
      applied++
    return {
      // ИДЕНТИЧНОСТЬ БЛОКА переносим: перевод — это то же содержимое на другом языке,
      // а не новые пункты. Без blockId следующая версия получала новые id, и всё, что
      // на идентичности держится (привязка обсуждений, отметки «просмотрено», дифф),
      // читало перевод как «всё удалено и всё добавлено» (ADR-0013).
      blockId: s.blockId ?? undefined,
      type: s.type,
      // Текст-блок переводится (это основной носитель смысла в списках-разборах);
      // poll/quiz/product-контент в v1 оставляем как есть.
      content: gotMd ? { ...s.content, md: addBlockTranslation(s.content?.md, sourceLang, targetLang, md ?? '') } : s.content,
      title,
      desc: descOut,
      command: s.command,
      hasImage: s.hasImage,
      imageKey: s.imageKey ?? undefined,
      level: s.level,
      why,
      section: s.section as LocaleText, // секция — заголовок урока; переведём в v2
      // Пометка «здесь нужен человек» — свойство пункта, а не языка: перевод её не
      // отменяет. Набор шагов переписывается целиком, поэтому не перенести = стереть.
      needsHuman: s.needsHuman,
      needsHumanAsk: s.needsHumanAsk as LocaleText,
      // ⚠️ «РАЗРУШИТЕЛЬНЫЙ ПУНКТ» — ТОЖЕ СВОЙСТВО ПУНКТА, А НЕ ЯЗЫКА, и переносить его
      // надо ЯВНО. Без этой строки поле приезжало пустым, `toStepInput` честно включал
      // свой тристейт и ставил пометку по виду команды — то есть перевод подменял
      // решение автора мнением детектора. Автор, снявший пометку с безопасного
      // `# make reset` в комментарии, после добавления языка получал её обратно.
      danger: s.danger,
      subtasks,
      refs: refsOut,
    }
  })

  // Мету переводим по тому же правилу: заголовок и описание могли переписать, пока шёл
  // перевод, и тогда перевод относится к прежнему тексту.
  const meta = {
    title: add(after.title, pick(after.title) === current.title ? translated.title : ''),
    desc: add(after.desc, pick(after.desc) === current.desc ? translated.desc : ''),
  }
  // ВЕРСИЯ РОЖДАЕТСЯ, ТОЛЬКО ЕСЛИ В НЕЙ ЕСТЬ ПЕРЕВОД.
  //
  // Условие считает ПЕРЕВЕДЁННОЕ, а не «уцелевшее». Прежнее «и заголовок тоже устарел»
  // пропускало самый обычный случай: соавтор переставил блоки, заголовок с описанием не
  // тронул — ни один блок не нашёл своего перевода, а версия всё равно писалась. Человек
  // получал `ok` без единого тоста, список оставался на прежнем языке, в истории висела
  // заметка «translate → English», наблюдателям уходило уведомление, а платный вызов был
  // списан. Тихая неудача под видом успеха — ровно то, чего у нас быть не должно.
  if (!applied && !gotLang(after.title, meta.title) && !gotLang(after.desc, meta.desc)) return { error: 'stale' }

  const note = `translate → ${langEnName(targetLang)}`
  // Переведённые title/desc едут ВНУТРИ addVersion (Ф2a-довесок): одна транзакция
  // с версией, канон коммита сразу несёт свежую мету.
  try {
    await listStore.addVersion(tpl.id, {
      note,
      steps: toStepInput(proposed),
      authorId: session.userId,
      meta,
      // Слияние выше закрыло ДОЛГОЕ окно (два вызова модели); эта строка закрывает
      // короткое — между перечитыванием свежего состава и записью. Сверку делает ядро
      // в той же транзакции, где строка списка уже взята `for update`.
      expectedVersion: after.currentVersion,
    })
  } catch (e) {
    if (e instanceof ListWriteError && e.code === 'stale') return { error: 'stale' }
    throw e
  }
  await notifyWatchersNewVersion(tpl.id, session.userId)

  const owner = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  if (owner[0]) revalidatePath(`/${owner[0].handle}/${tpl.slug}`)
  return { ok: true }
}

// ── AI: примечание к версии из диффа (What changed & why) ────────────
export async function generateChangeNoteAction(
  templateId: string,
  itemsJson: string,
): Promise<{ note: string } | { error: string }> {
  const session = await requireSession()
  const [lang, tpl] = await Promise.all([
    getLang(),
    db.query.templates.findFirst({
      where: (t) => eq(t.id, templateId),
      with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
    }),
  ])
  // Доступно всем, кто может видеть список: владельцу на /edit и предлагающему на
  // /suggest. Генерация читает публичный контент + их черновик; расход считается
  // per-user и ограничен rate-limit'ом + месячной AI-квотой (как generate/refine).
  if (!tpl || !canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return { error: 'forbidden' }

  const { allowed } = await checkRateLimit(`note:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'ai_quota' }

  const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  const baseSteps = cur
    ? await db.select().from(steps).where(eq(steps.versionId, cur.id)).orderBy(asc(steps.n))
    : []
  // Заметку пишем по СТРУКТУРНОМУ диффу — тому же, что показывает страница сравнения.
  // Списком заголовков правка описания или команды не видна, и модель, не найдя
  // разницы, сочиняла совет вместо описания (жалоба владельца 04.08.2026).
  const baseCmp = rowsToCmp(baseSteps as unknown as Parameters<typeof rowsToCmp>[0], lang)
  const nextRows = toProposedItems(parseEditorItems(itemsJson), lang)
  const nextCmp = rowsToCmp(nextRows as unknown as Parameters<typeof rowsToCmp>[0], lang)
  const { entries, summary } = diffSteps(baseCmp, nextCmp)
  // Менять нечего — модель не зовём вовсе: это и лишний расход, и источник выдумок.
  if (!hasChanges(summary)) return { error: 'nochange' }

  const note = await generateChangeNote(summarizeDiffForNote(entries), lang, { userId: session.userId, refType: 'template', refId: tpl.id })
  if (!note) return { error: 'aifail' }
  return { note }
}

// ── Автозаголовок ссылки: тянем <title>/og:title со страницы по URL ──────────
// Кнопка «сгенерировать» в ref-блоке редактора: пользователь вставил URL — по нему
// достаём человекочитаемое название страницы в подпись. Требуем сессию + rate-limit;
// SSRF-гейт (протоколы, приватные хосты, redirect-hop, DNS-rebind) — в fetchPublicUrl.

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)) } catch { return '' } })
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
  const tt = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return decodeEntities(og?.[1] ?? tt?.[1] ?? '').slice(0, 120)
}

export async function fetchLinkTitleAction(url: string): Promise<{ label: string } | { error: string }> {
  const session = await requireSession()
  const { allowed } = await checkRateLimit(`linktitle:${session.userId}`)
  if (!allowed) return { error: 'ratelimited' }

  let u: URL
  try { u = new URL(url.trim()) } catch { return { error: 'badurl' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'badurl' }

  try {
    const res = await fetchPublicUrl(u, {
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': botUserAgent(), accept: 'text/html,application/xhtml+xml' },
    })
    if (!res) return { error: 'badurl' }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return { error: 'fetchfail' }
    const html = (await res.text()).slice(0, 200_000)
    const label = extractTitle(html)
    return label ? { label } : { error: 'fetchfail' }
  } catch {
    return { error: 'fetchfail' }
  }
}

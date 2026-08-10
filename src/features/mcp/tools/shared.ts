import 'server-only'
import { canViewList } from '@/core'
import { findRisky } from '@/core/domain/destructive-command'
// eslint-disable-next-line no-restricted-imports -- MCP: доступ по userId токена, canViewList на месте у каждого вызова
import { getTemplateDetail } from '@/features/library/queries'
import { and, eq } from 'drizzle-orm'
import { db, listRedirects, templates, users, type ProposedItem } from '@/shared/db'
import { resolveUserByHandle } from '@/shared/db/resolve-list'
import { tr, trKey, type LocaleText } from '@/shared/i18n'
import { detectTextLang } from '@/shared/lib/translit'
import { emptyBlock, toProposedItems, type EditorItem } from '@/features/library/editor'
import { isBlockType, newOptionId } from '@/features/library/blocks'
import { isCollaborator } from '@/features/collab/queries'

/**
 * Общее для инструментов MCP. Пока это одна проверка доступа, но именно она нужна
 * каждому сюжету — чтениям, записи, прогонам, — и жить ей в одном из них значило бы
 * тянуть за собой весь файл ради одной функции.
 */

// Единая проверка «зритель вправе видеть» для MCP: тот же canViewList, что и на
// сайте, но коллаборатора (для приватного/черновика) досчитываем лениво.
export async function mcpCanView(tpl: { id: string; ownerId: string; visibility: 'public' | 'private'; status: 'draft' | 'published'; moderation: string }, userId: string): Promise<boolean> {
  const isOwner = tpl.ownerId === userId
  const isCollab = !isOwner && (tpl.visibility === 'private' || tpl.status === 'draft') ? await isCollaborator(tpl.id, userId) : false
  return canViewList(tpl, { isOwner, isCollaborator: isCollab })
}

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'https://setfork.com').replace(/\/$/, '')

export interface McpBlockOption {
  id?: string // стабильный id варианта: к нему привязаны голоса опроса и попытки теста
  text: string
  correct?: boolean // только для quiz — верный вариант
}

// Один блок списка через MCP. type по умолчанию 'step'. Поля по типу:
//  step  — title(+desc/command/level/why/section/subtasks/refs); text — text(markdown);
//  file  — url + fileName (ссылка на документ/вложение);
//  image — caption(+imageRef); video — url(+caption); poll — question/options/multi/deadline;
//  quiz  — question/explain + по quizKind: choice=options(correct)/multi;
//          text=accept/caseSensitive; number=answer/tolerance.
export interface McpItemInput {
  /** Идентичность блока сквозь версии (как отдаёт get_list). Пришёл — блок остаётся
   *  ТЕМ ЖЕ: при нём живут комментарии к пункту, голоса, попытки и merge по id. */
  bid?: string
  type?: string
  title?: string
  desc?: string
  command?: string
  level?: 'required' | 'recommended' | 'optional'
  why?: string
  section?: string
  subtasks?: string[]
  refs?: { label: string; url?: string }[] // step — ссылки под шагом (док, источник)
  text?: string
  caption?: string
  imageRef?: string
  url?: string
  fileName?: string // file — имя вложения (url = ссылка на уже загруженный файл)
  // get_list отдаёт эти поля как name/ref — принимаем ОБЕ формы, иначе круг
  // «прочитал → отдал обратно в update_list» терял имя файла и ссылку картинки.
  name?: string
  ref?: string
  needsHuman?: boolean // step — «здесь нужен человек» (машина честно не знает)
  needsHumanAsk?: string // step — что именно спросить у человека
  /** step — разрушительный пункт (в собранном скрипте приезжает закомментированным).
   *  Не передан — решается по команде (см. toStepInput), явный false уважается. */
  danger?: boolean
  question?: string
  options?: McpBlockOption[]
  multi?: boolean
  deadline?: string
  explain?: string
  quizKind?: string // 'choice'(default)|'text'|'number'|'blank'
  accept?: string[] // quiz text
  caseSensitive?: boolean // quiz text/blank
  answer?: number // quiz number
  tolerance?: number // quiz number
  template?: string // quiz blank — текст с '___'
  blanks?: string[][] // quiz blank — принимаемые ответы на каждый пропуск
  pairs?: { left: string; right: string }[] // quiz match — пары для сопоставления
  sortItems?: string[] // quiz sort — элементы в ПРАВИЛЬНОМ порядке
}

// MCP-контент нейтрален к языку → кладём под 'en' (locale-JSON, tr с фолбэком читает).
// Строим EditorItem-ы и прогоняем через общий сериализатор блоков (bid, poll/quiz/video
// content — та же логика, что у веб-редактора). Ноль дублирования блочной модели.
export function toProposed(items: McpItemInput[]): ProposedItem[] {
  const editor: EditorItem[] = (items ?? []).map((it): EditorItem => {
    const type = isBlockType(it.type ?? '') ? (it.type as EditorItem['type']) : 'step'
    // Пришедший bid СОХРАНЯЕМ: блок остаётся тем же сквозь версии (комментарии,
    // голоса, попытки, merge по идентичности). Нет bid — блок новый, id выдаст emptyBlock.
    const fresh = emptyBlock(type)
    // section (заголовок урока) есть у ЛЮБОГО блока и get_list его отдаёт всем —
    // но переносила его только step-ветка ниже, и запись через API теряла урок
    // у текста, картинки, опроса и теста. Ставим один раз, до ветвления по типу.
    const b: EditorItem = { ...fresh, bid: (it.bid ?? '').trim() || fresh.bid, section: (it.section ?? '').trim() }
    // id варианта — якорь голоса/попытки: свой, если прислан, иначе новый.
    const optId = (o: McpBlockOption) => (o?.id ?? '').trim() || newOptionId()
    if (type === 'text') return { ...b, text: (it.text ?? '').trim() }
    if (type === 'image') return { ...b, imageKey: (it.imageRef ?? it.ref ?? '').trim(), caption: (it.caption ?? '').trim() }
    if (type === 'video') return { ...b, videoUrl: (it.url ?? '').trim(), caption: (it.caption ?? '').trim() }
    if (type === 'file') return { ...b, fileUrl: (it.url ?? '').trim(), fileName: (it.fileName ?? it.name ?? '').trim() }
    if (type === 'poll')
      return { ...b, poll: { question: (it.question ?? '').trim(), options: (it.options ?? []).map((o) => ({ id: optId(o), text: (o.text ?? '').trim() })), multi: it.multi === true, deadline: (it.deadline ?? '').trim() } }
    if (type === 'quiz') {
      const KINDS = ['text', 'number', 'blank', 'match', 'sort', 'code'] as const
      const kind = (KINDS as readonly string[]).includes(it.quizKind ?? '') ? (it.quizKind as (typeof KINDS)[number]) : 'choice'
      return {
        ...b,
        quiz: {
          ...b.quiz,
          kind,
          question: (it.question ?? '').trim(),
          options: (it.options ?? []).map((o) => ({ id: optId(o), text: (o.text ?? '').trim(), correct: o.correct === true })),
          multi: it.multi === true,
          accept: (it.accept ?? []).map((a) => String(a)),
          caseSensitive: it.caseSensitive === true,
          answer: typeof it.answer === 'number' ? String(it.answer) : '',
          tolerance: typeof it.tolerance === 'number' ? String(it.tolerance) : '',
          template: (it.template ?? '').toString(),
          blanks: (it.blanks ?? []).map((b2) => (Array.isArray(b2) ? b2.map((x) => String(x)).join(', ') : String(b2))),
          pairs: (it.pairs ?? []).map((p) => ({ left: String(p?.left ?? ''), right: String(p?.right ?? '') })),
          items: (it.sortItems ?? []).map((s) => String(s)),
          explain: (it.explain ?? '').trim(),
        },
      }
    }
    return {
      ...b,
      title: (it.title ?? '').trim(),
      desc: (it.desc ?? '').trim(),
      command: it.command?.trim() ?? '',
      level: it.level ?? 'required',
      why: (it.why ?? '').trim(),
      section: (it.section ?? '').trim(),
      // Скриншот шага и «здесь нужен человек» — тоже содержимое пункта, а не мета:
      // без них круг чтения-записи стирал картинку и вопрос к человеку.
      imageKey: (it.imageRef ?? it.ref ?? '').trim(),
      needsHuman: it.needsHuman === true,
      needsHumanAsk: (it.needsHumanAsk ?? '').trim(),
      // Пометку разрушительности НЕ приводим к false молча: неуказанную решит
      // детектор на записи, и авто-простановка не потеряется на пути через API.
      danger: it.danger,
      subtasks: (it.subtasks ?? []).filter((s) => s.trim()),
      // Ссылки шага: get_list их отдаёт, а положить было нечем — асимметрия чтения
      // и записи. Пустые метки отсеивает сериализатор (toProposedItems).
      refs: (it.refs ?? []).map((r) => ({ label: String(r?.label ?? '').trim(), url: String(r?.url ?? '').trim() })),
    }
  })
  return toProposedItems(editor, 'en')
}

// Один блок списка → представление для MCP-контекста нейросети. Отдаём ВСЕ типы
// (не только шаги): текст/картинка/опрос/видео/тест — иначе AI видит лишь часть.
export type DetailStep = NonNullable<Awaited<ReturnType<typeof getTemplateDetail>>>['steps'][number]
export function blockForMcp(s: DetailStep) {
  const type = (s.type ?? 'step') as string
  const c = (s.content ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  // Идентичность блока СКВОЗЬ версии. Источник правды — колонка block_id (на ней
  // комментарии к пункту и blame); content.bid — легаси-дом не-step блоков, он
  // может РАСХОДИТЬСЯ с каноном у строк, которым id проставлял бэкфилл. Порядок
  // тот же, что у редактора (toEditorItems): канон первичен, content.bid — фолбэк.
  // Отдай мы content.bid, круг чтения-записи затирал бы канон и рвал комментарии.
  const bid = s.blockId || str(c.bid) || undefined
  if (type === 'text') return { n: s.n, bid, type, text: str(c.md) }
  if (type === 'image') return { n: s.n, bid, type, ref: str(c.ref) || undefined, caption: str(c.caption) || undefined }
  if (type === 'video') return { n: s.n, bid, type, url: str(c.url), caption: str(c.caption) || undefined }
  if (type === 'file') return { n: s.n, bid, type, url: str(c.url), name: str(c.name) }
  if (type === 'poll') {
    // id вариантов — якорь голосов (poll_votes.option_id). Отдаём их наружу: без id
    // круг «прочитал → записал» перевыдавал варианты заново и голоса осиротевали.
    const opts = Array.isArray(c.options) ? (c.options as Record<string, unknown>[]) : []
    return {
      n: s.n,
      bid,
      type,
      question: str(c.question),
      options: opts.map((o) => ({ id: str(o.id) || undefined, text: str(o.text) })),
      multi: c.multi === true || undefined,
      deadline: str(c.deadline) || undefined,
    }
  }
  if (type === 'quiz') {
    const KINDS = ['text', 'number', 'blank', 'match', 'sort', 'code']
    const kind = KINDS.includes(c.kind as string) ? (c.kind as string) : 'choice'
    // id вариантов теста — якорь попыток (quiz_attempts.selected), как у опроса.
    const base = { n: s.n, bid, type, quizKind: kind, question: str(c.question), explain: str(c.explain) || undefined }
    if (kind === 'text' || kind === 'code') return { ...base, accept: Array.isArray(c.accept) ? (c.accept as unknown[]).map((a) => str(a)) : [], caseSensitive: c.caseSensitive === true || undefined }
    if (kind === 'sort') return { ...base, sortItems: Array.isArray(c.items) ? (c.items as unknown[]).map((x) => str(x)) : [], caseSensitive: c.caseSensitive === true || undefined }
    if (kind === 'number') return { ...base, answer: typeof c.answer === 'number' ? c.answer : undefined, tolerance: typeof c.tolerance === 'number' ? c.tolerance : undefined }
    if (kind === 'blank')
      return { ...base, template: str(c.template), blanks: Array.isArray(c.blanks) ? (c.blanks as unknown[]).map((b) => (Array.isArray(b) ? b.map((x) => str(x)) : [str(b)])) : [], caseSensitive: c.caseSensitive === true || undefined }
    if (kind === 'match')
      return { ...base, pairs: Array.isArray(c.pairs) ? (c.pairs as Record<string, unknown>[]).map((p) => ({ left: str(p.left), right: str(p.right) })) : [], caseSensitive: c.caseSensitive === true || undefined }
    const opts = Array.isArray(c.options) ? (c.options as Record<string, unknown>[]) : []
    return { ...base, options: opts.map((o) => ({ id: str(o.id) || undefined, text: str(o.text), correct: o.correct === true })), multi: c.multi === true || undefined }
  }
  return {
    n: s.n,
    bid,
    type: 'step',
    title: tr(s.title, 'en'),
    desc: tr(s.desc, 'en'),
    command: s.command || undefined,
    // Скриншот шага и пометка «здесь нужен человек» — часть содержимого пункта:
    // круг без них стирал картинку и приглашение ответить из личного опыта.
    imageRef: s.imageKey ?? undefined,
    needsHuman: s.needsHuman || undefined,
    needsHumanAsk: tr(s.needsHumanAsk, 'en') || undefined,
    // Пометка автора и ПОДСКАЗКА детектора — раздельно. Слей их в одно поле, и
    // круг «прочитал → записал» превратил бы догадку про команду в решение автора.
    danger: s.danger || undefined,
    dangerHint: (!s.danger && findRisky(s.command ?? '')?.reason) || undefined,
    level: s.level,
    why: tr(s.why, 'en') || undefined,
    subtasks: s.subtasks.map((x) => tr(x, 'en')).filter(Boolean),
    // Ссылка без подписи — нормальная ссылка (её показывают доменом), поэтому
    // фильтруем по «есть хоть что-то», иначе чтение теряло бы то, что записано.
    refs: s.refs.map((r) => ({ label: tr(r.label, 'en'), url: r.url })).filter((r) => r.label || r.url),
  }
}

/**
 * Список по человеческой ссылке «handle/slug» (или просто «slug»), с учётом
 * ПЕРЕЖНИХ адресов: переименование списка и смена ника владельца ссылку не рвут.
 *
 * Так же ведёт себя GitHub API: `GET /repos/{owner}/{repo}` по прежнему имени
 * отвечает 301 на новый адрес, а клиенты за ним следуют. Здесь HTTP-редиректа нет —
 * поэтому вместо него возвращается `movedTo`, и инструмент кладёт его в ответ:
 * агент видит, что адрес устарел, и обновляет свои ссылки сам.
 *
 * Ссылка без владельца («slug») остаётся как была: она и раньше находила первый
 * подходящий список, прежние адреса ищутся так же.
 */
export async function resolveListRefOrMoved(
  ref: string,
): Promise<{ id: string; slug: string; ownerHandle: string; ownerId: string; movedTo: string | null } | null> {
  const [rawOwner, rawSlug] = ref.includes('/') ? ref.split('/') : [null, ref]
  const slug = (rawSlug ?? '').trim()
  if (!slug) return null

  const found = await findByAddress(rawOwner?.trim() || null, slug)
  if (found) return found

  // Промах — ищем прежний адрес: сначала владельца (ник мог смениться), потом слаг.
  const ownerId = rawOwner ? (await resolveUserByHandle(rawOwner.trim()))?.id ?? null : null
  if (rawOwner && !ownerId) return null

  // Ник сменился, а слаг НЕТ — список лежит по текущему слагу у этого владельца, и в
  // прежних адресах его нет вовсе. Без этого шага ссылка вида «прежний-ник/слаг»
  // терялась (поймано интеграционным тестом).
  if (ownerId) {
    const [byOwner] = await db
      .select({ id: templates.id, slug: templates.slug, ownerHandle: users.handle, ownerId: templates.ownerId })
      .from(templates)
      .innerJoin(users, eq(users.id, templates.ownerId))
      .where(and(eq(templates.ownerId, ownerId), eq(templates.slug, slug)))
      .limit(1)
    if (byOwner) return { ...byOwner, movedTo: `${byOwner.ownerHandle}/${byOwner.slug}` }
  }

  const [moved] = await db
    .select({ templateId: listRedirects.templateId })
    .from(listRedirects)
    .where(ownerId ? and(eq(listRedirects.ownerId, ownerId), eq(listRedirects.slug, slug)) : eq(listRedirects.slug, slug))
    .limit(1)
  if (!moved) return null

  const [row] = await db
    .select({ id: templates.id, slug: templates.slug, ownerHandle: users.handle, ownerId: templates.ownerId })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(eq(templates.id, moved.templateId))
    .limit(1)
  return row ? { ...row, movedTo: `${row.ownerHandle}/${row.slug}` } : null
}

/** Точное совпадение адреса — как было до прежних адресов. */
async function findByAddress(owner: string | null, slug: string) {
  const [row] = await db
    .select({ id: templates.id, slug: templates.slug, ownerHandle: users.handle, ownerId: templates.ownerId })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(owner ? and(eq(users.handle, owner), eq(templates.slug, slug)) : eq(templates.slug, slug))
    .limit(1)
  return row ? { ...row, movedTo: null } : null
}

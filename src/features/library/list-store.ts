import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { List, ListStore, Moderation, NewStepInput } from '@/core'
import { canEditList, editBlockReason, ListWriteError } from '@/core'
import { db, templateVersions, templates, users } from '@/shared/db'
import { isContentLang } from '@/shared/i18n/iso639'
import { initialModeration } from '@/shared/moderation/publication-state'
import { captureError } from '@/shared/observability'
import { listStore as drizzleStore } from './list-store.adapter'
import { carryTranslations, type NextStep, type PrevStep } from './translation-carry'
import { listReadRemote, listWriteRemote } from './list-store.remote'

// Фасад порта ListStore — точка катовера домена на Rust.
// READS → Rust ListRead при SETFORK_DOMAIN_READS=1 (переходный флаг).
// WRITES (addVersion И create) — ВСЕГДА Rust ListWrite, без флага (Ф1 трека
// git-format): версия рождается git-first в ядре (коммит main → проекция в
// Postgres), локального drizzle-пути записи больше нет — он был второй
// половиной двойного канона. Требует работающего ядра (SETFORK_CORE_URL/ADDR),
// как и весь git-слой после Ф0b.
// Потребители импортируют ТОЛЬКО отсюда.
const coreOn = !!process.env.SETFORK_CORE_URL
const remoteReads = coreOn && process.env.SETFORK_DOMAIN_READS === '1'

const base: ListStore = {
  ...drizzleStore,
  ...(remoteReads ? listReadRemote : {}),
  ...listWriteRemote,
}

// Хук «после addVersion»: регистрируется в composition root (instrumentation),
// чтобы фасад library НЕ импортировал moderation напрямую — границы слоёв запрещают
// features зависеть друг от друга (инверсия, как registerIndexSource). До регистрации
// пусто — безопасно (addVersion до старта воркера не вызывается).
type AfterVersionHook = (templateId: string) => Promise<void>
let afterVersion: AfterVersionHook | null = null
export function registerAfterVersion(fn: AfterVersionHook): void {
  afterVersion = fn
}

// Барьер модерации: новая версия = изменение контента → пере-проверка публичного
// списка. Раньше recheckList звался вручную на каждом addVersion-пути (saveNewVersion,
// acceptSuggestion, MCP, gardener) — забытый вызов = «отмывка» (залил чистое, прошёл
// модерацию, подменил на нарушающее). Теперь recheck висит на фасаде addVersion И create —
// единых точках, которые обойти нельзя (create без хука пропускал ПЕРВУЮ версию нового
// списка мимо модерации — аудит core 2026-07-20, F3). Сам recheckList самозащищён по
// visibility и дедуплицируется, поэтому хук безопасен для всех вызывающих.
async function moderate(templateId: string): Promise<void> {
  if (!afterVersion) return
  try {
    await afterVersion(templateId)
  } catch {
    /* модерация не должна ронять сохранение — recheckList и так глушит свои ошибки */
  }
}

// Жёсткий backstop состояния на ЕДИНОЙ write-точке версий (та же философия, что
// барьер moderate ниже: точку обойти нельзя). Любая новая версия существующего
// списка — это правка; в архиве/заморозке запрещена. Экшены гейтят раньше и
// по-человечески (редирект), сюда доходит только обход/гонка → бросаем. create
// (новый список) не трогаем — у нового id состояния нет.
//
// Бросаем `ListWriteError`, а не безымянный `Error`: «сюда доходит только обход» —
// это про происхождение вызова, а не про то, кто смотрит на экран. Гейты есть не у
// всех экшенов: «Вернуть эту версию» и «Принять правку» `canEditList` не спрашивают
// вовсе, и барьер для них — ЕДИНСТВЕННАЯ проверка. Оба ловят `ListWriteError` и
// показывают причину; на обычном `Error` человек получал безымянную страницу ошибки,
// хотя причина известна ровно здесь и называется одним словом.
async function assertVersionAllowed(templateId: string): Promise<void> {
  const [st] = await db
    .select({ archivedAt: templates.archivedAt, frozenAt: templates.frozenAt })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  if (st && !canEditList(st)) {
    throw new ListWriteError(editBlockReason(st) ?? 'frozen')
  }
}

/**
 * Страховка на окно выкатки: фронт и ядро выкатываются порознь, и сборка ядра без
 * поля `moderation` (или откат образа назад) молча запишет свой дефолт — 'active'.
 * Тогда список, который обязан ждать проверку, оказался бы публичным, а гейта после
 * create больше нет, и исправить это было бы некому.
 *
 * Поэтому: сверяем ответ ядра с решением и, если оно потеряно, закрываем список
 * апдейтом — с записью в observability, потому что окно между вставкой и этой
 * строкой существует. Это АВАРИЙНЫЙ путь (старое ядро), а не нормальная работа:
 * с ядром, знающим поле, ветка не выполняется вовсе.
 */
async function enforceModeration(list: List, expected: Moderation): Promise<void> {
  if (expected === 'active' || list.moderation === expected) return
  await db.update(templates).set({ moderation: expected }).where(eq(templates.id, list.id))
  captureError(new Error('core ignored moderation on create — list was public until this update'), {
    where: 'listStore.create',
    listId: list.id,
    expected,
    got: list.moderation,
  })
}

/**
 * Перенос переводов — на той же ЕДИНОЙ точке, что и барьеры выше, и по той же
 * причине: правило «не тронул поле — сохрани прежнее целиком» пришлось бы
 * помнить в каждом из путей записи (форма, черновик, предложение правки,
 * садовник). Забытое в одном из них, оно молча стирает переводы всего списка.
 *
 * Но применяется он НЕ ко всякой записи, а только к той, что сама объявила себя
 * одноязычной (`langScope`). Записи, распоряжающейся всем LocaleText сразу —
 * MCP, перевод, импорт, — переносить нечего, и вмешательство было бы вредным:
 * `patch_list` умеет убрать один язык, оставив второй, и перенос воскрешал бы
 * убранный. Это поймал интеграционный тест, а не рассуждение.
 *
 * Сопоставление идёт с ТЕКУЩЕЙ версией: именно её показывал редактор.
 */
async function withCarriedTranslations(templateId: string, input: NewStepInput[]): Promise<NewStepInput[]> {
  // Метку снимаем ВСЕГДА: она транспортная и до ядра доезжать не должна.
  const steps = input.map(({ langScope: _scope, ...rest }) => rest)
  if (!input.some((s) => s.langScope)) return steps

  const [tpl] = await db
    .select({ current: templates.currentVersion })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  if (!tpl) return steps
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.version, tpl.current)))
    .limit(1)
  if (!ver) return steps
  const prev = await db.query.steps.findMany({ where: (s) => eq(s.versionId, ver.id) })
  return carryTranslations(steps as NextStep[], prev as PrevStep[]) as NewStepInput[]
}

/**
 * Язык оригинала нового списка (ADR-0030) — на ЕДИНОЙ точке создания, как модерация: правило
 * «известный язык содержимого → настройка автора → язык, на котором он пишет» размазанное по
 * семи путям создания, в одном из них потерялось бы.
 *
 * Ядро пока про язык не знает (шаг 3 — поле в каноне `list.v1`), поэтому язык ставится
 * апдейтом после вставки — как `enforceModeration`. Не код ISO 639-1 — не пишем: пусто лучше
 * неверного, пустой язык угадывается по алфавиту.
 */
async function resolveListLang(input: { ownerId: string; lang?: string | null; writingLang?: string | null }): Promise<string | null> {
  if (isContentLang(input.lang)) return input.lang
  const [owner] = await db.select({ listLang: users.listLang }).from(users).where(eq(users.id, input.ownerId)).limit(1)
  if (isContentLang(owner?.listLang)) return owner.listLang
  return isContentLang(input.writingLang) ? input.writingLang : null
}

export const listStore: ListStore = {
  ...base,
  async addVersion(templateId, input) {
    await assertVersionAllowed(templateId)
    const steps = await withCarriedTranslations(templateId, input.steps)
    const ver = await base.addVersion(templateId, { ...input, steps })
    await moderate(templateId)
    return ver
  },
  async create(input) {
    // Состояние публикации решается ЗДЕСЬ, до записи, и уезжает в ядро значением
    // вставки. Раньше список рождался видимым, а гейт прятал его отдельным апдейтом
    // после — между этими двумя шагами публичный список недоверенного автора был
    // виден всем, а при сбое гейта оставался виден навсегда (fork/page.tsx 005).
    // Точка одна и обойти её нельзя — как барьер moderate ниже и assertVersionAllowed
    // выше: правило, размазанное по семи местам создания списка, теряется в одном из них.
    const moderation = await initialModeration(input)
    const { lang: _lang, writingLang: _writing, ...rest } = input
    const list = await base.create({ ...rest, moderation })
    await enforceModeration(list, moderation)
    const lang = await resolveListLang(input)
    if (lang) await db.update(templates).set({ lang }).where(eq(templates.id, list.id))
    await moderate(list.id)
    return list
  },
}

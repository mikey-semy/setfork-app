import 'server-only'
import { eq } from 'drizzle-orm'
import type { ListStore } from '@/core'
import { canEditList } from '@/core'
import { db, templates } from '@/shared/db'
import { listStore as drizzleStore } from './list-store.adapter'
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
async function assertVersionAllowed(templateId: string): Promise<void> {
  const [st] = await db
    .select({ archivedAt: templates.archivedAt, frozenAt: templates.frozenAt })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  if (st && !canEditList(st)) {
    throw new Error(`list ${st.archivedAt ? 'archived' : 'frozen'}: new versions are not allowed`)
  }
}

export const listStore: ListStore = {
  ...base,
  async addVersion(templateId, input) {
    await assertVersionAllowed(templateId)
    const ver = await base.addVersion(templateId, input)
    await moderate(templateId)
    return ver
  },
  async create(input) {
    const list = await base.create(input)
    await moderate(list.id)
    return list
  },
}

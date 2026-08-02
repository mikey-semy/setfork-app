import 'server-only'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
// Порт GitCore. Право звать его переехало сюда вместе с самой функцией: файл
// ВЫНЕСЕН из actions.ts ради безопасности (см. шапку ниже), а не заведён рядом.
// eslint-disable-next-line boundaries/dependencies -- вынос из 'use server'-файла, см. шапку
import { gitCore } from '@/features/git/core'
import { db, templates, users } from '@/shared/db'

/**
 * Пуш зеркала через ядро — и запись неудачи, о которой ядро не узнало.
 *
 * ⚠️ ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, а не `actions.ts`, где эта функция жила раньше.
 * `actions.ts` начинается с `'use server'`, а значит КАЖДЫЙ его экспорт — это
 * серверный экшен, вызываемый из браузера кем угодно по идентификатору. То есть
 * посторонний мог дёргать пуш чужого зеркала с любыми owner/slug, а после того
 * как сюда добавилась запись статуса — ещё и портить чужую строку (находка
 * авто-ревью fe#645, седьмой заход: `server-auth-actions`).
 *
 * Проверку прав сюда не поставить: главный вызывающий — фоновый подметальщик, у
 * него нет сессии. Поэтому функция просто перестала быть экшеном. Права проверяют
 * те, кто зовёт её от имени человека (`mirror-actions`: только владелец списка).
 */
export async function pushListMirror(
  owner: string,
  slug: string,
): Promise<{ ok: boolean; error: string; delivered: boolean }> {
  // Момент начала — он же метка «наша попытка новее того, что записало ядро».
  const startedAt = new Date()
  const res = await gitCore
    .mirrorPush({ owner, slug })
    .then((r) => ({ ...r, delivered: true }))
    .catch(() => ({ ok: false, error: CORE_UNAVAILABLE, delivered: false }))
  if (!res.delivered) await recordUndeliveredMirrorPush(owner, slug, startedAt)
  return res
}

const CORE_UNAVAILABLE = 'core unavailable'

/**
 * Записать неудачу, о которой ядро не узнало.
 *
 * Зачем здесь, а не у вызывающих. Пуш зеркала зовут из трёх мест: подметальщик,
 * сохранение настроек и кнопка «Синхронизировать». Пока запись была только в
 * подметальщике, два других теряли неудачу целиком — и это не мелочь:
 * `saveMirror` перед пушем ОБНУЛЯЕТ `mirror_error`, а подметальщик берёт только
 * строки с ошибкой. Настроил зеркало при лежащем ядре — и оно не синхронизируется
 * НИКОГДА, молча, пока случайная новая версия списка не заставит ядро записать
 * ошибку самому.
 *
 * Пишем ровно то же, что записало бы ядро: текст, время попытки и счётчик неудач
 * (по нему растёт пауза). Иначе повторы шли бы с минимальной паузой всю аварию.
 *
 * ⚠️ Условие на время — защита от ДВОЙНОГО счёта. `delivered:false` означает «мы
 * не получили ответ», а не «ядро не получило запрос»: ядро могло всё сделать и
 * записать, а ответ потеряться или опоздать к дедлайну. Тогда его запись новее
 * начала нашего вызова — и мы не трогаем строку, иначе одна и та же неудача
 * считалась бы дважды и лестница пауз проходилась бы вдвое быстрее обещанного.
 */
async function recordUndeliveredMirrorPush(owner: string, slug: string, startedAt: Date): Promise<void> {
  await db
    .update(templates)
    .set({
      mirrorError: CORE_UNAVAILABLE,
      mirrorSyncedAt: new Date(),
      mirrorAttempts: sql`${templates.mirrorAttempts} + 1`,
    })
    .where(
      and(
        eq(templates.slug, slug),
        eq(templates.ownerId, sql`(select ${users.id} from ${users} where ${users.handle} = ${owner})`),
        or(isNull(templates.mirrorSyncedAt), lt(templates.mirrorSyncedAt, startedAt)),
      ),
    )
    .catch(() => {}) // запись статуса не должна ронять сам вызов
}

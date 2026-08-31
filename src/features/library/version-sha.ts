import 'server-only'
import { captureError } from '@/shared/observability'

/**
 * SHA ВЕРСИЙ — ТОЧЕЧНО У ЯДРА, минуя фасад чтений.
 *
 * ⚠️ ПОЧЕМУ ОТДЕЛЬНО, А НЕ ЧЕРЕЗ `listStore.listVersions`. Фасад уходит в ядро только
 * при `SETFORK_DOMAIN_READS=1`, а этого флага нет ни в одном compose, ни в `.env`, ни в
 * примере. Значит отвечает Drizzle-адаптер, который ставит `commitSha: null` (колонки в
 * схеме и нет). Поверхность существовала, а значение было пустым ВСЕГДА — поймано
 * авторским ревью, и это второй за смену случай, когда «фича есть» проверялось на
 * дефолтах кода, а не на прод-конфигурации.
 *
 * Переключать канон чтений ради подписи версии нельзя: это отдельное решение со своей
 * приёмкой. Поэтому спрашиваем ядро ровно за тем, чего нет в Postgres, — за SHA.
 *
 * ⚠️ ОДИН ВЫЗОВ НА СТРАНИЦУ, а не по строке на версию: у ядра `ListVersions` отдаёт все
 * теги разом, и запрос на каждую строку превратил бы историю в десятки обращений.
 *
 * ⚠️ НИКОГДА НЕ РОНЯЕТ СТРАНИЦУ. Ядро недоступно, git-слой выключен, тега нет — пусто,
 * и поверхность покажет прочерк. Подпись версии полезна, но не настолько, чтобы из-за
 * неё не открывалась история.
 */
export async function versionShaMap(listId: string): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (!process.env.SETFORK_CORE_URL) return out
  try {
    const { listReadRemote } = await import('./list-store.remote')
    for (const v of await listReadRemote.listVersions(listId)) {
      if (v.commitSha) out.set(v.version, v.commitSha)
    }
  } catch (e) {
    captureError(e, { where: 'versionShaMap', listId })
  }
  return out
}

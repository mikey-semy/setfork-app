/**
 * КЛЮЧ INDEXNOW — из окружения (`INDEXNOW_KEY`), значение задаёт владелец на сервере.
 *
 * Нет ключа или он не по правилам протокола — функция выключена ЦЕЛИКОМ: ни файла ключа,
 * ни прохода. Невалидный ключ поисковик всё равно отверг бы (403), а проход долбил бы его.
 * Правило ключа — из спецификации (indexnow.org/documentation): 8–128 символов из
 * `a-z`, `A-Z`, `0-9` и `-`.
 *
 * Без `server-only`: ключ читает и middleware — ему нужен ответ до разбора адреса.
 */
const KEY_RE = /^[A-Za-z0-9-]{8,128}$/

export function indexNowKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.INDEXNOW_KEY?.trim()
  return key && KEY_RE.test(key) ? key : null
}

/** Путь файла ключа — в КОРНЕ сайта: ключ в подкаталоге подтверждал бы только адреса под ним. */
export const indexNowKeyPath = (key: string) => `/${key}.txt`

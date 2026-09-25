/**
 * Путь авторского файла скилла (`scripts/`, `references/`, `assets/`) — одно правило на все
 * входы: MCP `publish_skill`, редактор сайта, архив. Решает ядро (`input_name_ok`,
 * `AUTHORED_NAME_MAX_BYTES`); здесь — ранний отказ с понятной причиной, а не его текст
 * после поездки.
 */

/** Путь — ровно `<каталог>/<имя>`, как принимает ядро (ADR-0028). */
export const AUTHORED_PATH = /^(scripts|references|assets)\/[^/]+$/

/** Каталоги авторских файлов — в порядке показа. */
export const AUTHORED_DIRS = ['scripts', 'references', 'assets'] as const
export type AuthoredDir = (typeof AUTHORED_DIRS)[number]

/** Имя файла в заголовке ustar — не длиннее 100 байт (каталоги уходят в поле `prefix`).
 *  Запись ядро с 24.09 держит тем же пределом (`AUTHORED_NAME_MAX_BYTES`); пушем длинное
 *  имя пройти ещё может — его и отсеивает архив. Кириллица набирает 100 байт на ~50 знаках. */
export const AUTHORED_NAME_MAX_BYTES = 100
export const fitsArchive = (path: string): boolean =>
  new TextEncoder().encode(path.slice(path.lastIndexOf('/') + 1)).length <= AUTHORED_NAME_MAX_BYTES

/** Символы, которые ломают отображение имени или распаковку: управляющие, `\` и символы
 *  направления текста. Правило то же, что у ядра (`input_name_ok`). */
const BAD_NAME_CHAR = /[\p{Cc}\\‎‏‪-‮⁦-⁩]/u

/** Что не так с путём: код причины (для словаря и для текста MCP) либо `null`. */
export type AuthoredPathProblem = 'path' | 'dot' | 'chars' | 'long' | 'exec'

export function authoredPathProblem(path: string, executable: boolean | undefined): AuthoredPathProblem | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!AUTHORED_PATH.test(path) || path.split('/').includes('..')) return 'path'
  if (name.startsWith('.')) return 'dot'
  if (BAD_NAME_CHAR.test(name)) return 'chars'
  // Длиннее — лёг бы в дерево, но не в архив скилла: установился бы скилл без файла.
  if (!fitsArchive(path)) return 'long'
  if (executable && !path.startsWith('scripts/')) return 'exec'
  return null
}

/** Файл автора ТЕКСТОМ — как его правят в редакторе и держит черновик. Ядро принимает
 *  только текст (двоичное дерево отвергает), поэтому байты тут не нужны. */
export interface AuthoredText {
  path: string
  text: string
  executable: boolean
}

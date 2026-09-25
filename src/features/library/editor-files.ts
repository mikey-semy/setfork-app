import { authoredPathProblem, type AuthoredText } from '@/core/domain/authored-path'
import { findDestructiveInScript } from '@/core/domain/destructive-command'
import { findSecretInFile } from '@/core/domain/secret-scan'

/**
 * Поле `authored` формы редактора: файлы автора ПОЛНЫМ набором.
 *
 * Пусто или поля нет — `undefined`: «файлы не трогали», черновик держит то, что в нём
 * было, а публикация отдаст перенос набора ядру. Это не то же, что `[]` — пустой массив
 * стирает все файлы, и спутать их значило бы удалить набор у каждого, кто правил только
 * шаги.
 *
 * `'bad'` — прислали то, чего форма не шлёт (путь мимо правила, дубль, двоичное): форма
 * проверяет то же правило заранее, сюда такое доходит только в обход неё.
 */
export function parseEditorFiles(raw: unknown): AuthoredText[] | undefined | 'bad' {
  if (typeof raw !== 'string' || raw === '') return undefined
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return 'bad'
  }
  if (!Array.isArray(data)) return 'bad'
  const seen = new Set<string>()
  const out: AuthoredText[] = []
  for (const f of data) {
    if (!f || typeof f !== 'object') return 'bad'
    const { path, text, executable } = f as Record<string, unknown>
    if (typeof path !== 'string' || typeof text !== 'string' || typeof executable !== 'boolean') return 'bad'
    if (authoredPathProblem(path, executable) || seen.has(path)) return 'bad'
    // Двоичное дерево скилла не примет: признак тот же, что у git и у MCP.
    if (text.includes('\0')) return 'bad'
    seen.add(path)
    out.push({ path, text, executable })
  }
  return out
}

/**
 * Первое, что публикация файлов не пропустит, — для ПРЕДУПРЕЖДЕНИЯ при сохранении
 * черновика. Правила те же, что у стражей фасада (`assertNoDestructiveContent`,
 * `assertNoSecrets`): судятся скрипты по языку и все файлы на ключи.
 */
export function fileRefusalWarning(
  files: AuthoredText[],
): { kind: 'destructive'; path: string } | { kind: 'secret'; path: string; rule: string } | null {
  for (const f of files) {
    if (f.path.startsWith('scripts/') && findDestructiveInScript(f.path, f.text)) return { kind: 'destructive', path: f.path }
  }
  for (const f of files) {
    const hit = findSecretInFile(f.path, f.text)
    if (hit) return { kind: 'secret', path: f.path, rule: hit.rule }
  }
  return null
}

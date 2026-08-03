// Язык блока кода, когда автор не написал его в ограде (```python).
// Нужен для шапки карточки кода и для подсветки: в списках люди почти всегда
// вставляют код просто в ```, без языка, и «code» в шапке ничего не сообщает.
//
// Признаки — не «список популярных языков», а СИНТАКСИС: шебанг, объявления,
// характерная пунктуация. Порядок проверок от самого однозначного к общему;
// не опознали — вернём null, и шапка останется нейтральной.

export type DetectedLang =
  | 'bash' | 'python' | 'typescript' | 'javascript' | 'json' | 'yaml' | 'toml'
  | 'sql' | 'rust' | 'go' | 'html' | 'css' | 'dockerfile' | 'ini' | 'diff'

/** Опознаёт язык по содержимому. null — не уверены. */
export function detectCodeLang(code: string): DetectedLang | null {
  const src = code.trim()
  if (!src) return null
  const lines = src.split('\n')
  const first = lines[0].trim()

  // Шебанг и Dockerfile — однозначные маркеры.
  if (/^#!.*\b(bash|sh|zsh)\b/.test(first)) return 'bash'
  if (/^#!.*\bpython/.test(first)) return 'python'
  if (/^\s*FROM\s+\S+/i.test(first) && /^\s*(RUN|COPY|CMD|ENTRYPOINT|WORKDIR|ENV)\b/im.test(src)) return 'dockerfile'

  // Диффы: ведущие +/- и заголовки ханков.
  if (/^@@ -\d+/m.test(src) || (/^\+\+\+ /m.test(src) && /^--- /m.test(src))) return 'diff'

  // Данные: JSON целиком, YAML-ключи, TOML-секции.
  if (/^[[{]/.test(src) && /[}\]]$/.test(src) && /"[^"]*"\s*:/.test(src)) return 'json'
  if (/^\[[\w.-]+\]$/m.test(src) && /^[\w.-]+\s*=/m.test(src)) return 'toml'
  if (/^---\s*$/m.test(src) || (/^[\w.-]+:\s*(\S|$)/m.test(src) && !/[;{}]/.test(src) && !/^\s*(def|class|import)\b/m.test(src))) return 'yaml'
  if (/^[\w.-]+\s*=\s*\S+/m.test(src) && /^\[[\w.\s-]+\]$/m.test(src)) return 'ini'

  // Языки программирования.
  if (/^\s*(def|class)\s+\w+|^\s*(import|from)\s+\w+|\bprint\(|\bself\b/m.test(src)) return 'python'
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|::\w+|\bimpl\b|\bpub\s+(fn|struct|enum)\b/.test(src)) return 'rust'
  if (/\bfunc\s+\w+\s*\(|\bpackage\s+main\b|:=/.test(src)) return 'go'
  if (/\b(interface|type)\s+\w+\s*[={]|:\s*(string|number|boolean)\b|\bas\s+const\b/.test(src)) return 'typescript'
  if (/\b(const|let|var)\s+\w+\s*=|=>|\bfunction\s*\(|\bconsole\.(log|error)\b/.test(src)) return 'javascript'
  if (/\bSELECT\b[\s\S]*\bFROM\b|\b(INSERT INTO|UPDATE|CREATE TABLE|ALTER TABLE)\b/i.test(src)) return 'sql'

  // Разметка и стили.
  if (/^\s*<(!DOCTYPE|html|div|span|p|a|section)\b/i.test(src)) return 'html'
  if (/^[.#]?[\w-]+\s*\{[^}]*:[^}]*\}/m.test(src)) return 'css'

  // Командная строка: типовые утилиты в начале строки, пайпы, флаги.
  if (/^\s*[$>]\s/m.test(src)) return 'bash'
  if (/^\s*(sudo|apt|apt-get|brew|winget|choco|npm|npx|pnpm|yarn|pip|pipx|uv|poetry|git|docker|kubectl|curl|wget|ssh|scp|systemctl|make|cargo|go|python3?)\b/m.test(src)) return 'bash'
  if (/^\s*(cd|ls|mkdir|rm|cp|mv|cat|echo|export|chmod|chown|tar|unzip)\b/m.test(src)) return 'bash'

  return null
}

/** Подпись для шапки карточки: язык из ограды, иначе опознанный, иначе нейтральное. */
export function codeLabel(fenceLang: string | undefined, code: string): string {
  return fenceLang || detectCodeLang(code) || 'code'
}

// Лёгкое эвристическое определение языка для поля команды/кода (без тяжёлых
// детекторов). Порядок важен: специфичное раньше общего. Дефолт — shell (в списках
// это чаще всего команды). id → расширение CodeMirror маппится в CodeEditorInner.
export type CodeLang = 'shell' | 'javascript' | 'python' | 'sql' | 'yaml' | 'json' | 'dockerfile'

export const LANG_LABEL: Record<CodeLang, string> = {
  shell: 'bash',
  javascript: 'js',
  python: 'python',
  sql: 'sql',
  yaml: 'yaml',
  json: 'json',
  dockerfile: 'dockerfile',
}

export function detectLang(raw: string): CodeLang {
  const code = raw.trim()
  if (!code) return 'shell'

  // Dockerfile — инструкции в начале строк.
  if (/^\s*(FROM|RUN|CMD|ENTRYPOINT|COPY|ADD|WORKDIR|ENV|EXPOSE|ARG|LABEL)\s+\S/m.test(code)) return 'dockerfile'

  // JSON — начинается с { или [ и есть "key":.
  if (/^[[{]/.test(code) && /"[^"]*"\s*:/.test(code)) return 'json'

  // SQL — ключевые слова запросов.
  if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|DATABASE)|ALTER\s+TABLE|DROP\s+(TABLE|INDEX))\b/i.test(code)) return 'sql'

  // Python — def/class/импорты/типичные вызовы.
  if (/^\s*(def |class |import |from \w[\w.]* import |print\()/m.test(code) || /\b(elif|None|True|False|self)\b/.test(code)) return 'python'

  // JS/TS — объявления/стрелки/модули.
  if (/(^|\s)(const|let|var|function|export|import)\s|=>|require\(|console\.\w+/.test(code)) return 'javascript'

  // YAML — key: value в начале строк (или ---), без shell-маркеров ниже.
  if (/^---\s*$/m.test(code) || /^\s*[\w.-]+:\s+\S/m.test(code)) return 'yaml'

  // Shell — шебанг, $-промпт, типичные утилиты; иначе дефолт.
  if (
    /^\s*#!\s*\/.*\b(sh|bash|zsh)\b/m.test(code) ||
    /(^|\n)\s*\$\s+\S/.test(code) ||
    /\b(sudo|apt|apt-get|yum|dnf|brew|pacman|curl|wget|docker|docker-compose|kubectl|helm|git|npm|npx|yarn|pnpm|systemctl|service|ssh|scp|rsync|tar|unzip|chmod|chown|mkdir|rm|cp|mv|ls|cd|echo|cat|grep|sed|awk|export|source|make)\b/.test(code)
  ) {
    return 'shell'
  }

  return 'shell'
}

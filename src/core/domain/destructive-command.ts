/**
 * Проверка исполняемого выхода: «безопасно ли это ЗАПУСКАТЬ».
 *
 * Такого слоя в продукте не было ни одного. Проверялось всё, кроме пригодности к
 * исполнению:
 *  - `sanitizeCommand` спрашивает «похоже ли это вообще на команду» (правдоподобие,
 *    а не безопасность) и пропускает всё, где есть пробел, слеш, оператор или флаг;
 *  - модерация спрашивает про запрещённый КОНТЕНТ по таксономии MLCommons, где
 *    категории «опасно исполнять» нет вовсе, зато есть указание считать обычный
 *    DevOps безопасным;
 *  - планка готовности спрашивает «полезно ли, обосновано ли, можно ли улучшить».
 *
 * При этом список отдаётся как исполняемый скрипт и продукт сам предлагает
 * направить его в шелл. Ссылки при этом проверяются кодом на живость, а команды —
 * ничем и никогда, хотя исполняется именно команда.
 *
 * Набор намеренно УЗКИЙ. Это не эвристика «подозрительности» и не попытка угадать
 * намерение: каждый шаблон описывает действие, у которого нет законного применения
 * в пошаговом списке для другого человека, и каждый сопровождается причиной, которую
 * видно автору. Широкий фильтр здесь хуже узкого: он ловит честные команды, авторы
 * учатся его обходить, и доверие к отказу пропадает.
 *
 * Набор живёт в коде (а не в настройках) сознательно: это политика безопасности,
 * она обязана версионироваться вместе с кодом, проходить ревью и иметь тесты.
 * Пополняется по инцидентам — каждый новый шаблон приходит с тестом.
 */

export interface DestructiveMatch {
  /** Ключ причины — по нему берётся текст для автора из словаря. */
  reason: string
  /** Что именно совпало — для показа автору и для журнала. */
  fragment: string
}

interface Rule {
  reason: string
  re: RegExp
}

const RULES: Rule[] = [
  // Рекурсивное удаление корня или домашнего каталога. Вариации с -f/-r в любом
  // порядке, с --no-preserve-root и с путём, состоящим из одних слешей.
  // Граница справа включает кавычку: `bash -c "rm -rf /"` — исполнение, а не показ.
  { reason: 'wipesFilesystem', re: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+(--no-preserve-root\s+)?(\/|~|\/\*|\$HOME)(\s|$|\*|["'`])/i },
  // Запись поверх блочного устройства: гарантированная потеря диска целиком.
  { reason: 'overwritesDisk', re: /\b(dd|cat|tee)\b[^|;]*\bof=\/dev\/(sd|nvme|hd|vd|disk)/i },
  { reason: 'overwritesDisk', re: />\s*\/dev\/(sd|nvme|hd|vd|disk)[a-z0-9]*/i },
  // Форматирование файловой системы и уничтожение таблицы разделов.
  { reason: 'formatsDisk', re: /\bmkfs(\.[a-z0-9]+)?\s+\/dev\//i },
  // Форк-бомба: классическая и её пробельные варианты.
  { reason: 'forkBomb', re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
  // Скачать из сети и немедленно исполнить: делает содержимое списка неизвестным
  // и неповторяемым — ровно то, от чего список должен защищать.
  { reason: 'runsRemoteCode', re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/i },
  { reason: 'runsRemoteCode', re: /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(iex|Invoke-Expression)\b/i },
  // Рекурсивная выдача полных прав на системные каталоги.
  { reason: 'breaksPermissions', re: /\bchmod\s+(-[a-z]*R[a-z]*\s+)+(777|a\+rwx)\s+\/(etc|usr|var|bin|sbin|boot|lib)?(\s|$)/i },
  { reason: 'breaksPermissions', re: /\bchown\s+(-[a-z]*R[a-z]*\s+)+[^\s]+\s+\/(\s|$|etc|usr|var|bin)/i },
  // Выключение и перезагрузка чужой машины из «инструкции».
  { reason: 'haltsMachine', re: /\b(shutdown|halt|poweroff|reboot)\b(\s+-[a-z]+)*(\s+now)?\s*$/i },
]

/**
 * Строки команды в том виде, в каком их увидит интерпретатор.
 *
 * Разбор «по строкам как есть» обходится продолжением строки: `rm -rf \` и на
 * следующей строке `/` по отдельности не совпадают ни с одним правилом, а bash
 * склеивает их в `rm -rf /`. То же с конвейером, разорванным переносом. Поэтому
 * сначала склеиваем продолжения, и только потом проверяем.
 */
function joinContinuations(text: string): string[] {
  const out: string[] = []
  let acc = ''
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = acc + raw
    // Нечётное число обратных слешей в конце = продолжение (чётное — экранированный слеш).
    const trailing = /\\+$/.exec(line)
    if (trailing && trailing[0].length % 2 === 1) {
      acc = line.slice(0, -1)
      continue
    }
    acc = ''
    out.push(line)
  }
  if (acc) out.push(acc)
  return out
}

/** Комментарий вне кавычек до конца строки — это не исполняемая часть. */
function stripComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote && line[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

/**
 * Строка лишь ПЕЧАТАЕТ текст, а не исполняет его. Инструкция вправе показать
 * опасную команду как пример («вот так делать нельзя»), и блокировать за это —
 * ровно тот широкий фильтр, из-за которого авторы перестают доверять отказу.
 * Исполнители (`eval`, `bash -c`, `sh -c`) сюда НЕ попадают: у них содержимое
 * кавычек и есть исполняемая часть.
 */
const PRINTS_ONLY = /^\s*(sudo\s+)?(echo|printf|cat\s*<<|#)/i

/**
 * Первое совпадение или null. Проверяется КАЖДАЯ строка команды: многострочное поле
 * — это произвольный скрипт, и опасная строка может стоять не первой.
 */
export function findDestructive(command: string): DestructiveMatch | null {
  const text = (command ?? '').trim()
  if (!text) return null
  for (const joined of joinContinuations(text)) {
    const l = stripComment(joined).trim()
    if (!l || PRINTS_ONLY.test(l)) continue
    for (const rule of RULES) {
      const m = rule.re.exec(l)
      if (m) return { reason: rule.reason, fragment: m[0].trim().slice(0, 120) }
    }
  }
  return null
}

/**
 * Отказ записи. Живёт в домене, а не в адаптере: его ловят и адаптер, и серверные
 * действия, и MCP — импорт из инфраструктуры в фичу нарушил бы границы слоёв.
 * `reason` — ключ словаря, чтобы причина доходила до автора на его языке.
 */
export class DestructiveCommandError extends Error {
  constructor(
    readonly stepIndex: number,
    readonly reason: string,
    readonly fragment: string,
  ) {
    super(`destructive_command:${reason}`)
    this.name = 'DestructiveCommandError'
  }
}

/** Страж на записи: первый разрушительный шаг останавливает публикацию целиком. */
export function assertNoDestructiveSteps(steps: { command?: string | null }[]): void {
  const found = findDestructiveSteps(steps)
  if (!found.length) return
  const first = found[0]
  throw new DestructiveCommandError(first.index + 1, first.match.reason, first.match.fragment)
}

/** Индексы шагов с разрушительными командами — для отказа на записи. */
export function findDestructiveSteps(items: { command?: string | null }[]): { index: number; match: DestructiveMatch }[] {
  const out: { index: number; match: DestructiveMatch }[] = []
  items.forEach((it, index) => {
    const match = findDestructive(it.command ?? '')
    if (match) out.push({ index, match })
  })
  return out
}

/**
 * Отбраковка «фейковых» команд из ответа ИИ. Модель иногда вписывает в поле command
 * эхо названия шага (напр. "sugar_syrup" в кулинарном рецепте), хотя команды там нет.
 *
 * Настоящая команда содержит shell-семантику (пробел+аргументы, путь, флаг, пайп/оператор)
 * ЛИБО является известной короткой утилитой. Одиночный идентификатор без этих признаков
 * считаем мусором и заменяем на "". Чистая функция — без server-only/сети, легко тестируется.
 */
const KNOWN_CMDS = new Set([
  'ls', 'pwd', 'make', 'cargo', 'npm', 'pnpm', 'yarn', 'git', 'docker', 'node', 'python', 'python3',
  'pip', 'go', 'cat', 'htop', 'top', 'df', 'du', 'kubectl', 'terraform', 'psql', 'redis-cli', 'curl',
])

export function sanitizeCommand(raw: string): string {
  const cmd = (raw ?? '').trim()
  if (!cmd) return ''
  const looksShell = /[\s/\\|&;<>$`*(){}=]|--?\w/.test(cmd) // аргументы, путь, оператор или флаг
  if (looksShell) return cmd
  return KNOWN_CMDS.has(cmd.toLowerCase()) ? cmd : '' // одиночный токен — только из белого списка
}

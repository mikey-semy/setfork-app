import 'server-only'

/**
 * Диалог совета: при неоднозначном запросе совет вместо генерации отдаёт уточняющие вопросы.
 * Воркер (где крутится совет) кладёт вопросы, страница генерации показывает форму, пользователь
 * отвечает → ответы дозаписываются в generations.query (память нити) и генерация перезапускается.
 *
 * Хранилище — in-memory с TTL (воркер и веб в одном Node-процессе, см. council-progress.ts).
 * Мульти-инстанс → вопросы могли уйти на другой инстанс: форма не покажется, штатный откат
 * (генерация как обычно). Железный вариант — Redis/БД (следующий инкремент).
 */
const TTL_MS = 15 * 60_000

declare global {
  var __councilClarify: Map<string, { questions: string[]; exp: number }> | undefined
}
function store(): Map<string, { questions: string[]; exp: number }> {
  return (globalThis.__councilClarify ??= new Map())
}

export function setClarify(id: string, questions: string[]): void {
  if (!id || !questions.length) return
  const m = store()
  if (m.size > 500) {
    const now = Date.now()
    for (const [k, e] of m) if (e.exp <= now) m.delete(k)
  }
  m.set(id, { questions: questions.slice(0, 4), exp: Date.now() + TTL_MS })
}

export function getClarify(id: string): string[] {
  const e = store().get(id)
  if (!e || e.exp <= Date.now()) return []
  return e.questions
}

export function clearClarify(id: string): void {
  store().delete(id)
}

import { createHash } from 'node:crypto'

/**
 * Отпечаток СОДЕРЖИМОГО quiz-блока: что именно спросили и что считается верным.
 *
 * Попытка привязана к блоку по стабильному `bid` — это правильно для истории, но
 * `bid` переживает правку содержимого. Автор мог изменить сам вопрос и эталонный
 * ответ, сохранив блок, и прежнее «отвечено верно» продолжало засчитываться за новый
 * вопрос — вплоть до выдачи сертификата за курс, который человек в текущем виде не
 * проходил.
 *
 * В отпечаток входит только то, от чего зависит правильность ответа. Оформление —
 * пояснение после сдачи, подпись, порядок отображения — намеренно НЕ входит: правка
 * формулировки-обёртки не должна аннулировать честно сданный тест.
 */
export function quizContentHash(content: Record<string, unknown>): string {
  const str = (v: unknown) => String(v ?? '')
  const graded = {
    kind: content.kind ?? null,
    // choice: варианты и какие из них верны
    options: Array.isArray(content.options)
      ? (content.options as { id?: unknown; text?: unknown; correct?: unknown }[]).map((o) => ({
          id: str(o?.id),
          text: str(o?.text),
          correct: !!o?.correct,
        }))
      : null,
    // text/code: принимаемые ответы; number: эталон и допуск
    accept: Array.isArray(content.accept) ? (content.accept as unknown[]).map(str) : null,
    answer: typeof content.answer === 'number' ? content.answer : null,
    tolerance: typeof content.tolerance === 'number' ? content.tolerance : null,
    // sort / blank / match
    items: Array.isArray(content.items) ? (content.items as unknown[]).map(str) : null,
    blanks: Array.isArray(content.blanks) ? (content.blanks as unknown[][]).map((b) => (Array.isArray(b) ? b.map(str) : [])) : null,
    pairs: Array.isArray(content.pairs)
      ? (content.pairs as { left?: unknown; right?: unknown }[]).map((p) => ({ left: str(p?.left), right: str(p?.right) }))
      : null,
    caseSensitive: !!content.caseSensitive,
    // сам вопрос: смена формулировки меняет задачу. Для blank сама задача живёт в
    // template (текст с пропусками) — переписать его, сохранив принимаемые ответы,
    // значит задать другой вопрос.
    question: str(content.question ?? content.text),
    template: str(content.template),
  }
  return createHash('sha256').update(JSON.stringify(graded)).digest('hex').slice(0, 32)
}

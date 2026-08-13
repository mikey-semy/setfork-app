/**
 * Что именно очередь запоминает о падении задачи.
 *
 * Отдельным модулем, потому что нужен обеим сторонам: воркер собирает запись, очередь её
 * пишет — а импорт из очереди в воркер уже есть, обратный замкнул бы цикл.
 */

/**
 * Сколько символов ошибки храним в задаче. Колонка `last_error` — `text`, предела у неё нет;
 * предел наш: таблица очереди горячая (её читают reaper, уборка и админка), а разбор аварии
 * живёт в первых кадрах стека, не в сотом.
 */
export const JOB_ERROR_MAX = 1000

/** Сколько кадров стека вообще рассматриваем: дальше уже потроха рантайма. */
const MAX_FRAMES = 8

/** Обрезка с видимым признаком обрезки — иначе непонятно, оборвалось или так и было. */
function cut(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

/**
 * Приводит брошенное к записи для `jobs.last_error`.
 *
 * Бюджет делится в пользу АДРЕСА падения. Сообщения бывают огромными (ответ модели, текст SQL
 * с параметрами) — слепая обрезка по хвосту вытеснила бы стек целиком, и запись снова
 * говорила бы ЧТО упало, но не ГДЕ. Ровно это и случилось 13.08 с петлёй самогенерации:
 * «i.getTime is not a function», а место восстановить не удалось.
 */
export function errorForJob(e: unknown): string {
  if (!(e instanceof Error)) return cut(String(e), JOB_ERROR_MAX)

  const frames = (e.stack ?? '')
    .split('\n')
    // Первая строка стека — это сам message, поэтому кадры берём со второй.
    .slice(1, MAX_FRAMES + 1)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!frames.length) return cut(e.message, JOB_ERROR_MAX)

  // Сообщению — не больше половины бюджета: остаток гарантированно вмещает первые кадры,
  // а первый кадр и есть точка падения.
  const out = [cut(e.message, Math.floor(JOB_ERROR_MAX / 2))]
  let left = JOB_ERROR_MAX - out[0].length
  for (const frame of frames) {
    const need = frame.length + 1 // +1 на перевод строки
    if (need > left) break
    out.push(frame)
    left -= need
  }
  return out.join('\n')
}

/**
 * Страховка на записи: `failJob` зовут и не из воркера (текстом, который через `errorForJob`
 * не проходил), а колонка без предела молча приняла бы мегабайт.
 */
export function clampJobError(error: string): string {
  return cut(error, JOB_ERROR_MAX)
}

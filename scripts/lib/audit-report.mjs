// ОТЧЁТ `npm audit` — ОДИН ИСТОЧНИК НА ВСЕ ГЕЙТЫ, И РАЗДЕЛЕНИЕ ДВУХ РАЗНЫХ КРАСНЫХ.
//
// ⚠️ «НАШЛИ УЯЗВИМОСТЬ» И «НЕ СМОГЛИ СПРОСИТЬ» — РАЗНЫЕ СОБЫТИЯ, И ОТВЕТ У НИХ РАЗНЫЙ.
// `npm audit` возвращает ненулевой код в обоих случаях: и когда нашёл, и когда реестр
// ответил 403/5xx или сети не было. Гейт, различающий их только по коду возврата,
// краснеет от чужой недоступности — и приучает не читать свой красный. За сутки
// 02–03.09.2026 это случилось дважды: в логе «found 0 vulnerabilities», а джоба красная.
//
// Разделение сделано так же, как у смока: блокирует НАХОДКА, предупреждает НЕДОСТУПНОСТЬ.
// При этом «не смогли спросить» не выдаётся за «чисто»: сообщение прямо говорит, что
// гейт не отработал, и почему.
//
// Повтор — первый ответ на недоступность: разовый 5xx реестра лечится вторым запросом, и
// доводить до предупреждения незачем. Задержка растёт, чтобы не долбить упавший сервис.
import { execFileSync } from 'node:child_process'

const ATTEMPTS = 3
const BACKOFF_MS = [0, 2000, 6000]

/** Отчёт ли это. Операционный сбой приезжает как {message, statusCode} — без уязвимостей
 *  и метаданных, и «пустой» разбор такого ответа молча значил бы «всё чисто». */
export const looksLikeReport = (r) =>
  !!r && typeof r.vulnerabilities === 'object' && r.vulnerabilities !== null && !!r.metadata

/**
 * Почему отчёта нет — человеческой строкой для лога.
 *
 * ⚠️ Берём первое НЕПУСТОЕ, а не первое не-`undefined`. npm при отказе печатает
 * `{"error":{"code":…,"summary":"","detail":""}}` — с пустым summary, — и `??` такую
 * строку пропускает как «значение есть». В логе выходило «не отдал отчёт ()»: сообщение
 * есть, причины нет. Замечено на живом прогоне с недоступным реестром 03.09.2026.
 */
export const failureReason = (report, raw) => {
  const first = [report?.error?.summary, report?.error?.detail, report?.error?.code, report?.message]
    .map((x) => (typeof x === 'string' ? x.trim() : x))
    .find((x) => x)
  if (first) return String(first)
  const tail = (raw ?? '').trim()
  // eslint-disable-next-line no-restricted-syntax -- строки уходят в лог CI, не в интерфейс
  return tail ? `неожиданный вывод: ${tail.slice(0, 200)}` : 'пустой вывод'
}

/**
 * Один запрос отчёта с повторами.
 *
 * `run` подменяется в тестах: сеть в них не нужна, а нужно поведение вокруг ответа.
 * Возвращает `{ ok: true, report }` либо `{ ok: false, why }` — вызывающий решает, что
 * из этого блокирует, а что предупреждает.
 */
export function fetchAuditReport({ omitDev = false, run = defaultRun, sleep = defaultSleep } = {}) {
  const args = ['audit', '--json', ...(omitDev ? ['--omit=dev'] : [])]
  let last = 'попыток не было'
  for (let i = 0; i < ATTEMPTS; i++) {
    if (i > 0) sleep(BACKOFF_MS[i])
    const raw = run(args)
    let report = null
    try {
      report = JSON.parse(raw)
    } catch {
      report = null
    }
    if (looksLikeReport(report)) return { ok: true, report }
    last = failureReason(report, raw)
  }
  return { ok: false, why: last }
}

function defaultRun(args) {
  try {
    // Ненулевой код здесь — норма: так npm сообщает о НАЙДЕННЫХ уязвимостях. Отличать
    // находку от сбоя по коду нельзя, поэтому читаем вывод в обоих случаях.
    return execFileSync('npm', args, { encoding: 'utf8', shell: process.platform === 'win32' })
  } catch (e) {
    return e.stdout ?? ''
  }
}

function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Уязвимости уровня high/critical среди пакетов `only` (если задан). */
export function highOrCritical(report, only) {
  return Object.values(report.vulnerabilities).filter(
    (v) => ['high', 'critical'].includes(v.severity) && (!only || only.has(v.name)),
  )
}

// КАКИЕ ИНТЕГРАЦИОННЫЕ ТЕСТЫ ЗАВИСЯТ ОТ ЧАСА ПРОГОНА — СПИСКОМ, А НЕ РУКАМИ.
//
// Список выводится, а не перечисляется, ровно по той причине, по которой у нас уже
// обжигалась узда склонений: перечень «известного» видит только заведённое и молчит про
// новое. Новый тест такой же формы попадёт под недельную проверку сам.
//
// Признак: в одном файле встречаются СУТОЧНОЕ (или недельное) окно и ОТНОСИТЕЛЬНОЕ время.
// Именно их сочетание и опасно: 03.09.2026 тест ставил событие «час назад» и спрашивал
// «сколько сегодня» — в первый час суток событие попадало во вчера, и счёт выходил нулевым.
//
// ⚠️ ГРАНИЦА. Сдвиг ЦЕЛЫМИ СУТКАМИ (`now() - N days`) безопасен при любом часе: он
// попадает внутрь нужного дня всегда. Поэтому такие файлы тоже попадают в список — они
// дешёвые в прогоне, а отличить «минуты» от «суток» по тексту надёжно нельзя: сдвиг
// бывает собран из переменной. Пусть лучше прогонятся лишние четыре файла, чем список
// начнёт врать в сторону пропуска.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const WINDOW = /date_trunc\('(day|week|month)'|interval '\d+ (day|week|month)|OnDay|daysAgo|startOfDay/i
const RELATIVE = /now\(\)\s*-|Date\.now\(\)\s*-|minutesAgo|hoursAgo|interval '\d+ (minute|hour)/i

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.itest.ts') ? [p] : []
  })

export function daySensitiveTests(root = 'tests') {
  return walk(root)
    .filter((p) => {
      const s = readFileSync(p, 'utf8')
      return WINDOW.test(s) && RELATIVE.test(s)
    })
    .sort()
}

// Прямой запуск печатает список одной строкой — прямо в аргументы vitest.
if (process.argv[1]?.endsWith('day-sensitive-tests.mjs')) {
  console.log(daySensitiveTests().join(' '))
}

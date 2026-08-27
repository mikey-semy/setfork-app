#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, SRC, walkFiles, rel } from './lib/ui-scan.mjs'

/**
 * ДРЕЙФ ШКАЛ: сколько РАЗНЫХ значений живёт на одной оси.
 *
 * Отличается от `ui-parity.mjs` вопросом. Тот спрашивает «взяли ли примитив» и «не
 * написано ли значение числом мимо токена» — и по обоим сегодня ноль. Этот спрашивает
 * другое: даже если каждое значение законное, СКОЛЬКО ИХ. Ось, на которой в ходу
 * двадцать три разные максимальные ширины, выглядит одинаково беспорядочно независимо
 * от того, из токенов эти двадцать три или нет.
 *
 * Повод завести: владелец 25.08.2026 положил в корень репозитория `.ui-drift.json` со
 * словами «это я поднял вопрос глобально по всем проектам… там информация для нас».
 * Файл был снимком без инструмента: числа в нём проверить и пересчитать было нечем, а
 * значит через неделю они превращались в предание. Здесь тот же вопрос, но задаваемый
 * командой — и потому задаваемый снова.
 *
 * «Одиночка» — значение, встреченное в коде ОДИН раз. Именно они и есть дрейф: не
 * решение, а случай. Ось из пяти значений, каждое из которых в ходу двадцать раз,
 * здоровее оси из пяти значений, четыре из которых встретились однажды.
 */

const AXES = [
  ['ширина', /\b(?:max-)?w-((?:\[[^\]]+\])|[a-z0-9./-]+)/g],
  ['высота', /\b(?:min-|max-)?h-((?:\[[^\]]+\])|[a-z0-9./-]+)/g],
  ['отступ p', /\bp[xytrbl]?-((?:\[[^\]]+\])|[a-z0-9./-]+)/g],
  ['отступ m', /\bm[xytrbl]?-((?:\[[^\]]+\])|[a-z0-9./-]+)/g],
  ['зазор gap', /\bgap(?:-[xy])?-((?:\[[^\]]+\])|[a-z0-9./-]+)/g],
  ['кегль', /\btext-((?:\[[^\]]+\])|(?:xs|sm|base|lg|xl|\d?xl|caption|caption-lg|body|body-sm|body-lg|title|page|heading|stat|lead|display|display-lg|logo|logo-lg|logo-xl))\b/g],
  ['скругление', /\brounded(?:-[a-z]{1,2})?-((?:\[[^\]]+\])|[a-z0-9./-]+)/g],
  ['тень', /\bshadow-((?:\[[^\]]+\])|[a-z0-9./-]+)/g],
  ['z-index', /\bz-((?:\[[^\]]+\])|[a-z0-9./-]+)/g],
  ['трекинг', /\btracking-((?:\[[^\]]+\])|[a-z0-9./-]+)/g],
  ['интерлиньяж', /\bleading-((?:\[[^\]]+\])|[a-z0-9./-]+)/g],
]

/** Читаем из ТЕМЫ, а не из головы: список токенов — то, что объявлено в globals.css. */
const theme = readFileSync(join(ROOT, 'src', 'app', 'globals.css'), 'utf8')
const TOKENS = new Set([...theme.matchAll(/--(?:text|container|radius|shadow|spacing|leading|tracking)-([a-z0-9-]+):/g)].map((m) => m[1]))

/**
 * ШТАТНАЯ ШКАЛА Tailwind — тоже канон, а не самодеятельность.
 *
 * ⚠️ Первый прогон объявил «вне токенов» 56 значений высоты из 56, то есть ВСЁ,
 * включая `h-4` и `p-3`. Это ровно та ошибка замера, которую счётчик ролей допускал
 * шесть раз (K41* в карте корней): завышенный долг гонит чинить правильное. Числовой
 * шаг и ключевые слова Tailwind — это шкала фреймворка, на которой всё и построено;
 * «вне» здесь означает произвольное значение вроде `w-[137px]` или `h-37.5`.
 */
const TW_STEP = /^(?:px|0|0\.5|1|1\.5|2|2\.5|3|3\.5|4|5|6|7|8|9|10|11|12|14|16|20|24|28|32|36|40|44|48|52|56|60|64|72|80|96)$/
const TW_WORD = /^(?:full|auto|screen|fit|min|max|none|dvh|dvw|svh|lvh|px)$/
const canonical = (v) => TOKENS.has(v) || TW_STEP.test(v) || TW_WORD.test(v)

const LIST = process.argv.includes('--list')
const JSON_OUT = process.argv.includes('--json')

const counts = new Map(AXES.map(([k]) => [k, new Map()]))

for (const file of walkFiles(SRC, ['.tsx', '.ts'])) {
  const path = rel(file)
  const src = readFileSync(file, 'utf8')
  // Комментарии выбрасываем целиком: в док-блоках примитивов живут ПРИМЕРЫ классов
  // («было p-3/p-3.5/p-4»), и без этого ось раздувалась бы собственной документацией.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const [key, re] of AXES) {
    re.lastIndex = 0
    for (const m of code.matchAll(re)) {
      const v = m[1]
      const bag = counts.get(key)
      if (!bag.has(v)) bag.set(v, { n: 0, where: [] })
      const rec = bag.get(v)
      rec.n++
      if (rec.where.length < 3) rec.where.push(path)
    }
  }
}

/** Одиночка — встречена один раз. Токен темы одиночкой быть может (роль редкая), но
 *  тогда это вопрос «а нужна ли такая роль», а не «откуда взялось это число». */
const summary = AXES.map(([key]) => {
  const bag = counts.get(key)
  const values = [...bag.entries()].sort((a, b) => b[1].n - a[1].n)
  const once = values.filter(([, r]) => r.n === 1)
  const outside = values.filter(([v]) => !canonical(v))
  return { key, distinct: values.length, once: once.length, outside: outside.length, values }
})

if (JSON_OUT) {
  const out = {}
  for (const r of summary) out[r.key] = { разных: r.distinct, одиночек: r.once, вне_токенов: r.outside }
  console.log(JSON.stringify(out, null, 1))
  process.exit(0)
}

console.log('ДРЕЙФ ШКАЛ — сколько РАЗНЫХ значений на одной оси\n')
console.log(`${'ось'.padEnd(14)} ${'разных'.padStart(7)} ${'одиночек'.padStart(9)} ${'вне токенов'.padStart(12)}`)
for (const r of summary.sort((a, b) => b.once - a.once)) {
  console.log(`${r.key.padEnd(14)} ${String(r.distinct).padStart(7)} ${String(r.once).padStart(9)} ${String(r.outside).padStart(12)}`)
  if (LIST) for (const [v, rec] of r.values.filter(([, x]) => x.n === 1)) console.log(`      ${v} — ${rec.where[0]}`)
}
console.log('\nОдиночка — значение, встреченное в коде ОДИН раз: не решение, а случай.')

// Замер размеров контролов по коду: кто берёт высоту из шкалы (shared/ui/control.ts),
// а кто объявляет её руками. Считает, а не оценивает на глаз — потому что оценка на
// глаз уже дважды объявляла разнобой побеждённым (треки ui-system Ф0 и Ф5).
//
// Запуск: node scripts/ui-sizes.mjs [--list]
// Отчёт по результатам: setfork-hq/research/2026-08-13-ui-sizes.md
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const LIST = process.argv.includes('--list')

/** Примитивы шкалы: высоту задают сами, пропом size. Класс h-* на них — нарушение. */
const PRIMITIVES = new Set([
  'Button', 'IconButton', 'Input', 'Textarea', 'SearchField', 'FloatingInput',
  'SelectTrigger', 'SubmitButton', 'SplitButton',
])
/** Интерактивные элементы, которым высоту вообще осмысленно задавать. */
const INTERACTIVE = new Set(['button', 'input', 'select', 'textarea', 'a', 'Link'])

const TAILWIND_PX = { 5: 20, 6: 24, 7: 28, 8: 32, 9: 36, 10: 40, 11: 44, 12: 48, 13: 52, 14: 56 }

const files = []
;(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.tsx')) files.push(p)
  }
})(SRC)

const rows = []
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const tags = /<([A-Za-z][\w.]*)((?:[^<>{}]|\{[^{}]*\})*?)\/?>/gs
  let m
  while ((m = tags.exec(src))) {
    const [, tag, attrs] = m
    if (!INTERACTIVE.has(tag) && !PRIMITIVES.has(tag)) continue
    const cls = [...attrs.matchAll(/class(?:Name)?=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)]
      .map((c) => c[1] ?? c[2] ?? c[3])
      .join(' ')
    for (const [, variant, min, n] of cls.matchAll(/(?:^|\s|:)((?:max-sm:|sm:|md:|lg:|pointer-coarse:)?)(min-)?h-(\d+)\b/g)) {
      rows.push({
        file: relative(ROOT, file).replace(/\\/g, '/'),
        line: src.slice(0, m.index).split('\n').length,
        tag,
        primitive: PRIMITIVES.has(tag),
        variant: variant || 'base',
        min: !!min,
        px: TAILWIND_PX[Number(n)] ?? Number(n) * 4,
      })
    }
  }
}

const tally = (key) => {
  const map = new Map()
  for (const r of rows) {
    const k = key(r)
    if (k != null) map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map].sort((a, b) => b[1] - a[1])
}

const overrides = rows.filter((r) => r.primitive)
// min-h-11 на текстовой ссылке/кнопке — это ТАЧ-ЦЕЛЬ по правилу, а не своя высота.
const touchOnly = rows.filter((r) => !r.primitive && r.min && r.px === 44)
// h-0/h-1 — скрытый file-input и ползунок: к шкале контролов отношения не имеют.
const notControls = rows.filter((r) => !r.primitive && r.px <= 8)
const handRolled = rows.filter((r) => !r.primitive && !touchOnly.includes(r) && !notControls.includes(r))

console.log(`объявлений высоты на интерактивных элементах: ${rows.length}`)
console.log(`  из них нарушений шкалы: ${overrides.length + handRolled.length}`)
console.log(`    — высота задана поверх примитива: ${overrides.length}`)
console.log(`    — рукописный контрол мимо примитива: ${handRolled.length}`)
console.log(`  законных: ${touchOnly.length + notControls.length} (тач-цель ${touchOnly.length}, не контролы ${notControls.length})`)
console.log('\nпо высоте:')
for (const [k, v] of tally((r) => `${r.px}px${r.min ? ' (min)' : ''}`)) console.log(`  ${String(v).padStart(3)}  ${k}`)

if (LIST) {
  for (const [name, set] of [['ПОВЕРХ ПРИМИТИВА', overrides], ['РУКОПИСНЫЕ', handRolled], ['ЗАКОННЫЕ', [...touchOnly, ...notControls]]]) {
    console.log(`\n${name}:`)
    for (const r of set) console.log(`  ${r.file}:${r.line} <${r.tag}> ${r.variant}:${r.min ? 'min-' : ''}${r.px}px`)
  }
}

// ── Гриды без БАЗОВОГО grid-cols ──────────────────────────────────────────
// `grid-cols-N` у Tailwind — это `minmax(0, 1fr)`: трек умеет сжиматься. Голый
// `grid` даёт трек `auto`, который не уже своего min-content, поэтому одна длинная
// строка внутри распирает страницу — появляется горизонтальный скролл, которого по
// правилам мобильной вёрстки быть не должно. Симптом всегда один: «интерфейс уехал
// за границу экрана», а причина неочевидна, потому что в разметке ошибки не видно.
const grids = []
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  src.split('\n').forEach((line, i) => {
    for (const cls of line.matchAll(/class(?:Name)?=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const c = cls[1] ?? cls[2]
      if (!/(^|\s)grid(\s|$)/.test(c)) continue
      if (/(^|\s)grid-cols-/.test(c)) continue
      if (/(^|\s)(place-|grid-rows|grid-flow)/.test(c) || c.includes('auto-fit') || c.includes('auto-fill')) continue
      grids.push({ file: relative(ROOT, file).replace(/\\/g, '/'), line: i + 1, cls: c.slice(0, 110) })
    }
  })
}
console.log(`\nгридов без базового grid-cols (риск горизонтального скролла): ${grids.length}`)
if (LIST) for (const g of grids) console.log(`  ${g.file}:${g.line}  ${g.cls}`)

process.exit(overrides.length + handRolled.length + grids.length > 0 ? 1 : 0)

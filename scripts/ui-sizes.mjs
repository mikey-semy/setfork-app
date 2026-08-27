// Замер размеров контролов по коду: кто берёт высоту из шкалы (shared/ui/control.ts),
// а кто объявляет её руками. Считает, а не оценивает на глаз — потому что оценка на
// глаз уже дважды объявляла разнобой побеждённым (треки ui-system Ф0 и Ф5).
//
// Запуск: node scripts/ui-sizes.mjs [--list]
// Отчёт по результатам: setfork-hq/research/2026-08-13-ui-sizes.md
import { classesOf, readFileSync, rel, SRC, tags, walkFiles } from './lib/ui-scan.mjs'

const LIST = process.argv.includes('--list')

/** Примитивы шкалы: высоту задают сами, пропом size. Класс h-* на них — нарушение. */
const PRIMITIVES = new Set([
  'Button', 'IconButton', 'Input', 'Textarea', 'SearchField', 'FloatingInput',
  'SelectTrigger', 'SubmitButton', 'SplitButton',
])
/** Интерактивные элементы, которым высоту вообще осмысленно задавать. */
const INTERACTIVE = new Set(['button', 'input', 'select', 'textarea', 'a', 'Link'])

const TAILWIND_PX = { 5: 20, 6: 24, 7: 28, 8: 32, 9: 36, 10: 40, 11: 44, 12: 48, 13: 52, 14: 56 }

const files = walkFiles(SRC, ['.tsx'])

const rows = []
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  for (const el of tags(src)) {
    const { tag, attrs } = el
    if (!INTERACTIVE.has(tag) && !PRIMITIVES.has(tag)) continue
    const cls = classesOf(attrs)
    for (const [, variant, min, n] of cls.matchAll(/(?:^|\s|:)((?:max-sm:|sm:|md:|lg:|pointer-coarse:)?)(min-)?h-(\d+)\b/g)) {
      rows.push({
        file: rel(file),
        line: el.line,
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

/** Названные исключения. Ключ — `файл:тег`, а не файл: исключение обязано быть узким,
 *  иначе один законный случай прикрывает собой всё, что в файле появится потом.
 *  Список короткий намеренно — исключение без причины и без условия снятия превращает
 *  счётчик в украшение. Причина пишется здесь, а не в коде места: тогда её видно всем,
 *  кто читает замер, а не только тому, кто открыл файл. */
const NAMED = new Map([
  [
    'src/features/settings/SettingsForm.tsx:Textarea',
    'границы РОСТА поля с resize-y (min-h/max-h), а не высота контрола: сколько поле ' +
      'занимает в покое и докуда человек может его растянуть. Ступень шкалы задаёт первое ' +
      'и молчит про второе.',
  ],
  [
    'src/features/git/CloneDropdown.tsx:button',
    'сегментированный переключатель вкладок внутри поповера. TabNav — это НАВИГАЦИЯ ' +
      'ссылками (переезжающая полоска, маршруты), переключение состояния он не делает, ' +
      'а примитива под сегменты в проекте нет. Высота при этом на шкале: min-h-8 плюс ' +
      'pointer-coarse:min-h-11. Единственное такое место на весь код (замер ui-parity ' +
      '26.08.2026) — примитив заводим, когда появится второе.',
  ],
])

const overrides = rows.filter((r) => r.primitive && !NAMED.has(`${r.file}:${r.tag}`))
// min-h-11 на текстовой ссылке/кнопке — это ТАЧ-ЦЕЛЬ по правилу, а не своя высота.
const touchOnly = rows.filter((r) => !r.primitive && r.min && r.px === 44)
// К шкале контролов отношения не имеют две вещи, и обе — не «контрол в ряду»:
//  • h-0/h-1 — скрытый file-input и ползунок;
//  • всё, что ВЫШЕ ступеней шкалы (24…44px) настолько, что в ряд с кнопкой не встаёт:
//    клетка теплокарты 12px, поле обложки 148px. Их высоту задаёт содержимое или
//    сетка, а не роль контрола. Границы 20 и 48 — это ступени шкалы плюс-минус один
//    шаг: внутри них высота обязана быть ступенью, снаружи — не про шкалу вовсе.
//    ⚠️ Цена этого послабления: рукописная кнопка ростом 60px счётчику незаметна.
//    Такую ловит вторая семья `ui-parity` («кнопка нарисована руками»), а не эта.
const notControls = rows.filter((r) => !r.primitive && (r.px <= 8 || r.px < 20 || r.px > 48))
// Внутри shared/ui высота объявляется руками ПО ДОЛГУ СЛУЖБЫ: это дом примитивов,
// откуда её берут все остальные. Отделено 26.08.2026, когда честный разбор тегов
// впервые показал эти строки (ChatComposer, FloatingBack, ScrollToTop) — считать их
// нарушением значит требовать, чтобы примитив брал высоту у самого себя.
const inPrimitivesHome = rows.filter((r) => !r.primitive && r.file.startsWith('src/shared/ui/'))

const named = rows.filter((r) => NAMED.has(`${r.file}:${r.tag}`))
const legit = new Set([...touchOnly, ...notControls, ...inPrimitivesHome, ...named])
const handRolled = rows.filter((r) => !r.primitive && !legit.has(r))

console.log(`объявлений высоты на интерактивных элементах: ${rows.length}`)
console.log(`  из них нарушений шкалы: ${overrides.length + handRolled.length}`)
console.log(`    — высота задана поверх примитива: ${overrides.length}`)
console.log(`    — рукописный контрол мимо примитива: ${handRolled.length}`)
console.log(
  `  законных: ${legit.size} (тач-цель ${touchOnly.length}, не контролы ${notControls.length}, ` +
    `дом примитивов ${inPrimitivesHome.length}, названные исключения ${named.length})`,
)
for (const k of new Set(named.map((r) => `${r.file}:${r.tag}`))) console.log(`    · ${k} — ${NAMED.get(k)}`)
console.log('\nпо высоте:')
for (const [k, v] of tally((r) => `${r.px}px${r.min ? ' (min)' : ''}`)) console.log(`  ${String(v).padStart(3)}  ${k}`)

if (LIST) {
  for (const [name, set] of [['ПОВЕРХ ПРИМИТИВА', overrides], ['РУКОПИСНЫЕ', handRolled], ['ЗАКОННЫЕ', [...legit]]]) {
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
      grids.push({ file: rel(file), line: i + 1, cls: c.slice(0, 110) })
    }
  })
}
console.log(`\nгридов без базового grid-cols (риск горизонтального скролла): ${grids.length}`)
if (LIST) for (const g of grids) console.log(`  ${g.file}:${g.line}  ${g.cls}`)

// ── РЯДЫ: одна ступень на весь ряд ────────────────────────────────────────
// Шкала гарантирует, что ступени ровные, но НЕ гарантирует, что в одном ряду
// выбрана одна. Поле `sm` рядом с кнопкой `md` — это 28 против 32, и «волна
// разных высот» видна первым же взглядом (замечание владельца 13.08.2026).
// Кнопки при этом могут быть безупречны: в ряду с ними стоят селекты и поля.
//
// Эвристика, а не истина: смотрим контейнер-ряд (flex без flex-col) и контролы
// в его теле, обрываясь на содержимом порталов (поповер/меню/диалог) — оно
// рисуется в другом месте экрана и в ряд не встаёт.
const ROW_CTRL = ['Button', 'IconButton', 'Input', 'Textarea', 'SearchField', 'SelectTrigger', 'SubmitButton', 'FloatingInput']
const PORTAL = /<(PopoverContent|DropdownMenuContent|SelectContent|DialogContent|OverlayPanel|SheetContent|TooltipContent)\b/
const mixedRows = []
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const m = line.match(/class(?:Name)?=(?:"([^"]*)"|\{`([^`]*)`\})/)
    const cls = m ? (m[1] ?? m[2] ?? '') : ''
    if (!cls.includes('flex') || cls.includes('flex-col')) return
    const indent = line.length - line.trimStart().length
    const body = []
    for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
      const l = lines[j]
      if (PORTAL.test(l)) break
      if (l.trimStart().startsWith('</') && l.length - l.trimStart().length <= indent) break
      body.push(l)
    }
    const text = body.join('\n')
    const found = []
    for (const tag of ROW_CTRL) {
      const re = new RegExp(`<${tag}\\b((?:[^<>{}]|\\{[^{}]*\\})*?)/?>`, 'gs')
      let mm
      while ((mm = re.exec(text))) {
        const sm = mm[1].match(/size="(\w+)"/)
        found.push({ tag, size: sm ? sm[1] : 'md' })
      }
    }
    if (found.length < 2) return
    if (new Set(found.map((f) => f.size)).size > 1) {
      mixedRows.push({ file: rel(file), line: i + 1, found })
    }
  })
}
console.log(`\nрядов с РАЗНЫМИ ступенями у соседей: ${mixedRows.length}`)
if (LIST) for (const r of mixedRows) console.log(`  ${r.file}:${r.line}  ${r.found.map((f) => `${f.tag}=${f.size}`).join(', ')}`)

process.exit(overrides.length + handRolled.length + grids.length + mixedRows.length > 0 ? 1 : 0)

// Замер САМОПАЛА: сколько мест рисуют роль руками, когда для неё уже есть общий модуль.
//
// Боль владельца 26.08.2026: «на одной странице самописные элементы при существующем
// базовом модуле». Счётчик `ui-sizes.mjs` меряет РАЗМЕР контрола и по устройству не
// видит, взят ли контрол из общего модуля вообще — рукописная кнопка без высоты для
// него законна. Этот счётчик отвечает на другой вопрос: где роль переоткрыта заново.
//
// Запуск: node scripts/ui-parity.mjs [--list] [--json] [роль]
//
// Число «вхождений» — это МЕСТА, а не файлы: одна страница может переоткрыть роль
// пять раз. Правило чтения отчёта: сначала роли без примитива (его надо завести),
// потом роли с примитивом (свип), и только потом одиночки.
import { classesOf, attr, hasAttr, isHost, readFileSync, rel, SRC, tags, walkFiles } from './lib/ui-scan.mjs'

/** Дом общих модулей: внутри него рисовать роль руками — это и есть его работа. */
const HOME = /^src\/shared\/ui\//

const has = (cls, ...parts) => parts.every((p) => cls.includes(p))
const cls1 = (cls, re) => re.test(cls)
/** Классы — МНОЖЕСТВО, а не строка: рецепт узнаём по набору, а не по порядку слов.
 *  Первая версия искала «`rounded-full`, сразу за ним `px-`» и не видела пилюлю, между
 *  словами которой затесался фон (проверено мутацией 26.08.2026). Ровно та же ошибка,
 *  что и в старом разборе тегов, только этажом выше. */
const every = (cls, ...res) => res.every((re) => cls.split(/\s+/).some((c) => re.test(c)))

/** Поля, которым место в `Input`; флажки и файлы живут по своим правилам. */
const TEXTUAL = new Set(['', 'text', 'email', 'password', 'search', 'url', 'tel', 'number', 'date', 'time'])

const ROLES = [
  {
    key: 'спиннер',
    primitive: 'Spinner (свип 26.08.2026: было 60 мест в 44 файлах, стало 0; держит узда в eslint)',
    hint: 'ожидание рисуют классом animate-spin поверх своей вёрстки',
    match: ({ cls }) => cls.includes('animate-spin'),
  },
  {
    key: 'кнопка',
    primitive: 'Button / IconButton / SubmitButton / buttonClass',
    hint: 'рукописный <button> с оформлением: свой фон, рамка, скругление или отступы',
    match: ({ tag, cls }) =>
      tag === 'button' && cls1(cls, /(^|\s)(bg-|border|rounded|px-|py-|p-\d|shadow|hover:bg-)/),
  },
  {
    key: 'кнопка-невидимка',
    primitive: 'IconButton (или сознательный disable с причиной)',
    hint: 'рукописный <button> без оформления — часто законно (пункт меню, обёртка), но и он мимо тач-цели',
    match: ({ tag, cls }) =>
      tag === 'button' && !cls1(cls, /(^|\s)(bg-|border|rounded|px-|py-|p-\d|shadow|hover:bg-)/),
  },
  {
    key: 'поле',
    primitive: 'Input / FloatingInput / SearchField',
    hint: 'нативный <input> текстового типа мимо примитива (долг Ф16 трека ui-system)',
    match: ({ tag, attrs }) => tag === 'input' && TEXTUAL.has(attr(attrs, 'type') ?? ''),
  },
  {
    key: 'флажок',
    primitive: 'Checkbox / Switch',
    hint: 'нативный checkbox/radio: своя рамка, свой фокус, своя тач-цель',
    match: ({ tag, attrs }) => tag === 'input' && ['checkbox', 'radio'].includes(attr(attrs, 'type') ?? ''),
  },
  {
    key: 'многострочное поле',
    primitive: 'Textarea',
    hint: 'нативный <textarea>',
    match: ({ tag }) => tag === 'textarea',
  },
  {
    key: 'таблица',
    primitive: 'DataTable v2 (shared/ui/data-table)',
    hint: 'своя <table>: без сортировки, без карточной мобилы, со своей плотностью',
    match: ({ tag }) => tag === 'table',
  },
  {
    key: 'картинка',
    primitive: 'SmartImage / Avatar / GnomeAvatar',
    hint: 'нативный <img>: мимо next/image, мимо запасного вида при ошибке',
    match: ({ tag }) => tag === 'img',
  },
  {
    key: 'слой поверх',
    primitive: 'OverlayPanel / sheet / dropdown-menu / ConfirmDialog',
    hint: 'своя подложка fixed inset-0: свой z-слой, свой Escape, свой замок прокрутки',
    match: ({ cls }) => has(cls, 'fixed', 'inset-0'),
  },
  {
    key: 'пилюля',
    primitive: 'Badge (6 вариантов) / TagChip / StepLevelBadge',
    hint: 'своя пилюля rounded-full с отступами',
    match: ({ cls }) => every(cls, /^rounded-full$/, /^p[xy]?-/),
  },
  {
    key: 'вкладки',
    primitive: 'TabNav',
    hint: 'свой ряд вкладок: свой индикатор, своя клавиатура',
    match: ({ attrs }) => attr(attrs, 'role') === 'tablist',
  },
  {
    key: 'нативная подсказка',
    primitive: 'Tooltip',
    hint: 'title= на хостовом элементе: на пальце не показывается вовсе, читалке дублирует имя',
    match: ({ tag, attrs }) => isHost(tag) && hasAttr(attrs, 'title'),
  },
  {
    key: 'кликабельный не-контрол',
    primitive: 'button / IconButton (или role + обработка клавиш)',
    hint: 'onClick на div/span/li/tr: с клавиатуры недостижимо, читалка не объявляет',
    match: ({ tag, attrs }) => ['div', 'span', 'li', 'tr', 'td', 'p'].includes(tag) && hasAttr(attrs, 'onClick'),
  },
]

/**
 * ВТОРАЯ СЕМЬЯ: значение написано числом там, где для него есть токен темы.
 *
 * Роль выше — про компонент («кнопку нарисовали руками»), эта — про значение
 * («кегль/цвет/длительность написали числом мимо @theme»). Вопрос один и тот же:
 * взято ли из общего места. Поэтому и счётчик один, и храповик один.
 *
 * Исключаются вычисления (`calc`, `%`, `vh/vw`, `ch`, `em`, `--var`): это не значение
 * из шкалы, а выражение — токеном оно не станет.
 */
const COMPUTED = /calc\(|%|\d(?:vh|vw|ch)\]|(?:^|[^r])em\]|var\(|\(--|\bfr\]|auto\]|100dvh|min\(|max\(|clamp\(/
const VALUES = [
  { key: 'кегль числом', token: 'ступень --text-* из @theme', re: /text-\[[^\]]+\]/g },
  { key: 'цвет сырой переменной', token: 'утилита цвета из @theme (bg-accent-soft)', raw: true, re: /(?:bg|text|border|ring|fill|stroke|from|to|via|accent|outline|divide)-\(--[a-z0-9-]+\)/g },
  { key: 'длительность числом', token: 'dur-fast / dur-base / dur-slow', re: /(?:duration|delay)-\[[^\]]+\]|(?<![\w-])duration-\d+/g },
  { key: 'ширина числом', token: 'роль ширины (панель/меню/диалог) — шкалы пока НЕТ', re: /(?:max-|min-)?w-\[[^\]]+\]/g },
  { key: 'высота числом', token: 'шкала контролов CONTROL_H / роль высоты', re: /(?:max-|min-)?h-\[[^\]]+\]/g },
  { key: 'радиус числом', token: '--radius-* из @theme (rounded-md/lg/xl)', re: /rounded(?:-[trbl]{1,2})?-\[[^\]]+\]/g },
  { key: 'отступ числом', token: 'шаг сетки 4px (p-1 … p-8)', re: /(?<![\w-])[pm][xytblr]?-\[[^\]]+\]/g },
  { key: 'слой числом', token: 'словарь z-слоёв LAYER из control.ts', re: /(?<![\w-])z-\[[^\]]+\]/g },
  { key: 'тень числом', token: '--shadow-* из @theme (shadow-card)', re: /shadow-\[[^\]]+\]/g },
]

const only = process.argv.slice(2).find((a) => !a.startsWith('--'))
const LIST = process.argv.includes('--list')
const JSON_OUT = process.argv.includes('--json')
const roles = ROLES.filter((r) => !only || r.key.includes(only))

const values = VALUES.filter((v) => !only || v.key.includes(only))
const hits = new Map([...roles, ...values].map((r) => [r.key, []]))

// Значения считаем и в .ts тоже: рецепты классов живут в константах (control.ts,
// button-style.ts, HERO_INPUT), и там разнобой прячется охотнее, чем в разметке.
for (const file of walkFiles(SRC, ['.tsx', '.ts'])) {
  const path = rel(file)
  const src = readFileSync(file, 'utf8')

  // Строки-комментарии выбрасываем: в них живут ПРИМЕРЫ значений («ловим text-[..px]»),
  // и без этого счётчик считал бы собственную документацию за нарушение. Убираем только
  // целиком-комментарные строки — вырезать хвостовые опасно, в коде есть «https://».
  const code = src
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l))
    .join('\n')

  for (const v of values) {
    v.re.lastIndex = 0
    for (const m of code.matchAll(v.re)) {
      if (!v.raw && COMPUTED.test(m[0])) continue
      hits.get(v.key).push({ path, line: src.slice(0, m.index).split('\n').length, tag: m[0] })
    }
  }

  if (HOME.test(path) || !path.endsWith('.tsx')) continue
  for (const el of tags(src)) {
    const cls = classesOf(el.attrs)
    for (const role of roles) {
      if (role.match({ ...el, cls })) hits.get(role.key).push({ path, line: el.line, tag: el.tag })
    }
  }
}

if (JSON_OUT) {
  // Ключи сортируем: слепок читают глазами в дифференциале, и порядок обхода каталогов
  // не должен перетасовывать файл при каждом пересъёме.
  const out = {}
  for (const role of [...roles, ...values].sort((a, b) => a.key.localeCompare(b.key, 'ru'))) {
    const byFile = {}
    for (const h of hits.get(role.key)) byFile[h.path] = (byFile[h.path] ?? 0) + 1
    out[role.key] = Object.fromEntries(Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b)))
  }
  console.log(JSON.stringify(out, null, 1))
  process.exit(0)
}

const table = (title, defs, label) => {
  console.log(title)
  const rows = defs.map((r) => ({ role: r, list: hits.get(r.key) })).sort((a, b) => b.list.length - a.list.length)
  for (const { role, list } of rows) {
    const files = new Set(list.map((h) => h.path)).size
    console.log(`${String(list.length).padStart(4)} мест в ${String(files).padStart(3)} файлах  ${role.key}`)
    console.log(`                            → ${role[label]}`)
    if (list.length) {
      const top = [...list.reduce((m, h) => m.set(h.path, (m.get(h.path) ?? 0) + 1), new Map())]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
      console.log(`                            ${top.map(([f, n]) => `${f} ×${n}`).join(' · ')}`)
    }
    if (LIST) for (const h of list) console.log(`      ${h.path}:${h.line} ${h.tag}`)
  }
  return rows.reduce((a, r) => a + r.list.length, 0)
}

const a = table('РОЛЬ ПЕРЕОТКРЫТА РУКАМИ (вне src/shared/ui)\n', roles, 'primitive')
const b = table('\nЗНАЧЕНИЕ НАПИСАНО ЧИСЛОМ МИМО ТОКЕНА\n', values, 'token')
console.log(`\nвсего мест: ${a + b} (ролей ${a}, значений ${b})`)

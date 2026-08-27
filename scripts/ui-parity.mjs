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
import { classesOf, attr, hasAttr, innerOf, isHost, readFileSync, rel, SRC, tags, walkFiles } from './lib/ui-scan.mjs'

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
    key: 'заметка-плашка',
    primitive: 'Alert (variant danger/warn/ok/info) или cardClass({ tone })',
    hint: 'блок-состояние рисуют руками: свой тон, свой отступ, и роль для диктора не объявлена',
    /**
     * Признак: ТОНОВЫЙ ФОН вместе с рамкой и отступом. Именно эта тройка и есть
     * «плашка состояния» — предупреждение, ошибка, подсказка. Одного тона мало
     * (им красят значки и текст), рамки с отступом мало (это обычная карточка).
     */
    match: ({ tag, cls, attrs, local }) =>
      ['div', 'p', 'section', 'aside'].includes(tag) &&
      !recipe(attrs, local) &&
      /(^|\s)bg-(danger|warn|ok|accent)(\/|-soft)/.test(cls) &&
      /(^|\s)border(\s|-)/.test(cls) &&
      /(^|\s)(px-|py-|p-\d)/.test(cls),
  },
  {
    key: 'сегмент переключателя',
    primitive: 'SegmentedControl + Segment',
    hint: 'активный сегмент красят вручную (bg-primary text-primary-fg) — обойма и пилюля каждый раз свои',
    /**
     * Ищем ПРИЗНАК РОЛИ, а не тег. Роль размазана по двум тегам (`button` и `Link`) и по
     * двум слоям, поэтому правило «самопал среди кнопок» пропускало её целиком: восемь
     * обойм жили в коде и счётчик показывал ноль. Признак же один и ни на что другое не
     * похож — активный сегмент это `bg-primary` вместе с `text-primary-fg`.
     *
     * `buttonClass()` (главная кнопка формы) даёт ту же пару, но приходит рецептом —
     * и потому снимается тем же `recipe()`, что и везде.
     *
     * ⚠️ Пары классов МАЛО: тем же цветом красят бейдж мерности индекса и пузырь реплики
     * пользователя — фирменная плашка, а не выбор. Первый прогон поймал ровно их двоих.
     * Отличает сегмент УСЛОВИЕ: активная ветка тернарника. Плашка красится всегда.
     */
    match: ({ attrs, local }) => !recipe(attrs, local) && SEGMENT_ACTIVE.test(attrs),
  },
  {
    key: 'кнопка',
    primitive: 'Button / IconButton / SubmitButton / buttonClass',
    hint: 'рукописный <button> с оформлением: свой фон, рамка, скругление или отступы',
    // ⚠️ `className={buttonClass(…)}` — это ОБЩИЙ РЕЦЕПТ, а не самопал: вид, высота,
    // фокус и тач-цель приходят оттуда же, откуда у Button. Так пишут кнопку отправки
    // серверной формы, и считать её нарушением — врать замером. Первая версия счётчика
    // именно это и делала: 62 законных места лежали в «невидимках» и раздували число.
    match: ({ tag, cls, attrs, local }) =>
      tag === 'button' && !recipe(attrs, local) && cls1(cls, /(^|\s)(bg-|border|rounded|px-|py-|p-\d|shadow|hover:bg-)/),
  },
  {
    key: 'кнопка-невидимка',
    primitive: 'IconButton (или сознательный disable с причиной)',
    hint: 'голый <button> без вида и без общего рецепта — часто законно (обёртка, карточка), но мимо тач-цели и фокуса',
    match: ({ tag, cls, attrs, local }) =>
      tag === 'button' && !recipe(attrs, local) && !cls1(cls, /(^|\s)(bg-|border|rounded|px-|py-|p-\d|shadow|hover:bg-)/),
  },
  {
    key: 'поле',
    primitive: 'Input / FloatingInput / SearchField',
    hint: 'нативный <input> текстового типа мимо примитива (долг Ф16 трека ui-system)',
    match: ({ tag, attrs }) => tag === 'input' && TEXTUAL.has(attr(attrs, 'type') ?? ''),
  },
    {
    key: 'флажок',
    primitive: 'Checkbox / Radio / Switch',
    hint: 'нативный checkbox/radio: свой цвет, свой фокус, своя тач-цель',
    // ⚠️ Спрятанный `sr-only` нативный input под своей карточкой-подписью — это НЕ
    // самопал, а признанный приём: семантика и клавиатура остаются нативными, вид
    // рисует label (`has-checked:` в его классах). Заменять его примитивом нечем и
    // незачем — счётчик, считающий такое нарушением, гонит людей портить рабочее.
    match: ({ tag, attrs, cls }) =>
      tag === 'input' && ['checkbox', 'radio'].includes(attr(attrs, 'type') ?? '') && !cls.includes('sr-only'),
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
    primitive: 'Badge (11 вариантов × 2 ступени) / TagChip / StepLevelBadge; свип 26.08.2026: 62 → 21, остаток — кликабельные (роль «кнопка»)',
    hint: 'своя пилюля rounded-full с отступами',
    match: ({ cls }) => every(cls, /^rounded-full$/, /^p[xy]?-/),
  },
  {
    key: 'рецепт в константе файла',
    primitive: 'примитив или общий рецепт (cardClass, buttonClass, MenuItem, Chip)',
    hint: 'константа вида `card`/`btn`/`row`/`pill` со ВСЕМ видом сразу: общая ровно на один файл',
    // Корень K39* карты кластеров. Ловится не по имени, а по составу: строка, в которой
    // сошлись скругление, отступ, рамка-или-фон и кегль, — это рецепт целой поверхности,
    // и он обязан жить в примитиве. Считается по СТРОКЕ-ЛИТЕРАЛУ у объявления, поэтому
    // видит и `const card = '…'`, и стрелку `const row = (on) => `…``.
    //
    // ⚠️ Такая константа ещё и прячет место от eslint-узд: они смотрят className, а тут
    // className — это вызов. Поэтому проверка здесь, а не там.
    match: () => false,
    recipe: true,
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
    // ⚠️ У `iframe` (и у `svg`) title — это ИМЯ элемента, а не подсказка: без него врезка
    // безымянна для диктора. Правило `jsx-a11y/iframe-has-title` его как раз ТРЕБУЕТ.
    match: ({ tag, attrs }) => isHost(tag) && tag !== 'iframe' && tag !== 'svg' && hasAttr(attrs, 'title'),
  },
  {
    key: 'клик на не-контроле без клавиатуры',
    primitive: 'button / IconButton — или role + tabIndex + onKeyDown, как требует WAI-ARIA',
    hint: 'onClick на div/span, до которого нельзя добраться с клавиатуры',
    // ⚠️ Само по себе `onClick` на `div` — НЕ нарушение. Дропзона и выбираемая карточка
    // не могут быть <button>: внутри них живут свои кнопки, и нативная кнопка их бы
    // проглотила. Признанный путь для таких — role + tabIndex + обработка Enter/Пробела,
    // и он у нас применён верно в пяти местах из шести. Считать их долгом значило бы
    // гнать людей ломать рабочее (тот же K41, четвёртый раз за день).
    //
    // Нарушение — это клик БЕЗ клавиатурного пути. Ровно его и ищем.
    // `aria-hidden` тоже снимает вопрос: подложка «клик мимо» диктору не видна, а
    // клавиатурный путь закрытия — Esc.
    match: ({ tag, attrs }) =>
      ['div', 'span', 'li', 'tr', 'td', 'p'].includes(tag) &&
      hasAttr(attrs, 'onClick') &&
      !/(?:^|\s)aria-hidden(?![\w-])/.test(attrs) &&
      !(hasAttr(attrs, 'role') && hasAttr(attrs, 'tabIndex') && hasAttr(attrs, 'onKeyDown')),
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
const COMPUTED = /calc\(|%|\d(?:vh|vw|ch|dvh|dvw|svh|lvh)\]|(?:^|[^r])em\]|var\(|env\(|\(--|\bfr\]|auto\]|min\(|max\(|clamp\(/
const VALUES = [
  { key: 'кегль числом', token: 'ступень --text-* из @theme', re: /text-\[[^\]]+\]/g },
  { key: 'цвет сырой переменной', token: 'утилита цвета из @theme (bg-accent-soft)', raw: true, re: /(?:bg|text|border|ring|fill|stroke|from|to|via|accent|outline|divide)-\(--[a-z0-9-]+\)/g },
  { key: 'длительность числом', token: 'dur-fast / dur-base / dur-slow', re: /(?:duration|delay)-\[[^\]]+\]|(?<![\w-])duration-\d+/g },
  // ⚠️ Лукбихайнд обязателен: без него `shadow-[0_18px…]` попадает в ширины —
  // «shado·w-[» читается как `w-[`. Первая версия счётчика ровно так и ошиблась.
  { key: 'ширина числом', token: 'роль ширины из @theme (w-panel, max-w-page)', re: /(?<![\w-])(?:max-|min-)?w-\[[^\]]+\]/g },
  { key: 'высота числом', token: 'шкала контролов CONTROL_H / сетка 4px', re: /(?<![\w-])(?:max-|min-)?h-\[[^\]]+\]/g },
  { key: 'радиус числом', token: '--radius-* из @theme (rounded-md/lg/xl)', re: /rounded(?:-[trbl]{1,2})?-\[[^\]]+\]/g },
  { key: 'отступ числом', token: 'шаг сетки 4px (p-1 … p-8)', re: /(?<![\w-])[pm][xytblr]?-\[[^\]]+\]/g },
  { key: 'слой числом', token: 'словарь z-слоёв LAYER из control.ts', re: /(?<![\w-])z-\[[^\]]+\]/g },
  { key: 'тень числом', token: '--shadow-* из @theme (shadow-card)', re: /shadow-\[[^\]]+\]/g },
]

/**
 * ТРЕТЬЯ СЕМЬЯ: интерфейс, который не доходит до человека без зрения.
 *
 * Роль и значение — про то, откуда взят вид. Эта — про то, СКАЗАНО ли вслух то, что
 * видно глазами. Проверки нарочно узкие и проверяемые: «у кнопки со значком нет
 * имени» — это факт, а не мнение. Всё, что решается стандартными правилами
 * (`jsx-a11y`), живёт в линте; здесь то, чего эти правила не видят.
 *
 * Главный пример как раз такой: ссылка со значком внутри для `jsx-a11y` НЕ пустая —
 * содержимое есть. Но `<svg>` без имени диктор не читает, и человек слышит
 * «ссылка» без единого слова о том, куда она ведёт.
 */
const NAMED_BY = ['aria-label', 'aria-labelledby', 'title', 'label']
const named = (a) => NAMED_BY.some((x) => hasAttr(a, x))
/** Внутри осталось что-то, кроме значков и комментариев? Тогда имя даёт текст.
 *
 * ⚠️ Значком считается ТОЛЬКО компонент с числовым `size={14}` — так пишут иконки
 * lucide. Вырезать любой самозакрывающийся компонент нельзя: `<UserLine handle=… />`
 * несёт текст, и без этой оговорки счётчик объявил бы ссылку на человека безымянной
 * (поймано на первой же такой замене 26.08.2026 — тот же K41, только у меня самого). */
const hasText = (inner) =>
  inner
    .replace(/<[A-Z][\w.]*(?:[^<>{}]|\{[^{}]*\})*?\/>/gs, (tag) => (/\bsize=\{\d+\}/.test(tag) ? '' : tag))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .trim().length > 0

const A11Y = [
  {
    key: 'значок без имени',
    fix: 'IconButton с label (или aria-label на своём элементе)',
    hint: 'кнопка/ссылка, внутри которой только значок: диктор объявит её без единого слова',
    check: ({ tag, attrs, inner }) =>
      ['button', 'a', 'Link'].includes(tag) &&
      inner !== null &&
      !named(attrs) &&
      !/(?:^|\s)aria-hidden(?![\w-])/.test(attrs) &&
      !/\{\.\.\./.test(attrs) &&
      !/\{children\}/.test(inner) &&
      !hasText(inner),
  },
  {
    key: 'поле без имени',
    fix: 'Field (label) или aria-label',
    hint: 'текстовое поле без подписи, без id для label и без placeholder',
    // `before` — кусок текста перед тегом: поле, ОБЁРНУТОЕ в Field или label, имя уже
    // получило (Field кладёт контрол внутрь label, клик по подписи фокусирует поле).
    check: ({ tag, attrs, before }) =>
      tag === 'input' &&
      !['hidden', 'checkbox', 'radio', 'file', 'submit'].includes(attr(attrs, 'type') ?? '') &&
      !named(attrs) &&
      !hasAttr(attrs, 'placeholder') &&
      !hasAttr(attrs, 'id') &&
      !hasAttr(attrs, 'name') &&
      !/<(?:Field|label)\b(?![\s\S]*<\/(?:Field|label)>)/.test(before) &&
      !/\{\.\.\./.test(attrs),
  },
  {
    key: 'картинка без alt',
    fix: 'alt с текстом — если значимая; alt="" — если украшение',
    hint: 'без alt диктор читает имя файла',
    check: ({ tag, attrs }) => tag === 'img' && !hasAttr(attrs, 'alt') && !/\{\.\.\./.test(attrs),
  },
]

/**
 * Общие РЕЦЕПТЫ-ФУНКЦИИ из shared/ui: место, которое зовёт любой из них, берёт вид
 * оттуда же, откуда примитив, и самопалом не является. Список закрытый и короткий —
 * это ровно те четыре, что экспортирует библиотека.
 *
 * ⚠️ Без него счётчик числил нарушением кнопку на `buttonClass` (62 места, 26.08) и
 * сегменты сплит-кнопки на `splitSegment`. Ошибка в эту сторону дороже пропуска:
 * завышенный долг заставляет людей «чинить» правильное.
 */
/**
 * ОТМЕТКА «РАЗОБРАНО И ЗАКОННО»: `ui-parity-ok: <причина>` в комментарии над местом.
 *
 * Без неё храповик врал в другую сторону. Число в слепке не различало «до этого места
 * не дошли руки» и «сюда смотрели и решили, что примитив не годится»: пузырь реплики
 * изображает скруглениями хвостик, зона перетаскивания живёт пунктирной рамкой в две
 * толщины, сетка аватаров подсвечивает круг кольцом — всё это не карточка и общим
 * рецептом не рисуется. Пока сказать об этом было негде, такие места оставались в
 * долге навсегда, а долг переставал что-либо значить.
 *
 * Причина обязательна и не короче 20 знаков — отметка без объяснения это тот же
 * молчаливый пропуск, только узаконенный. Отмеченные места из долга уходят, но НЕ
 * исчезают: `--list` печатает их отдельным разделом, а гейт считает их число.
 */
const OK_MARK = /ui-parity-ok:\s*(\S.*)$/

/** Отметка действует на три строки вперёд и на три назад.
 *
 *  Вперёд — обычный случай, комментарий стоит над тегом. Назад — потому что над тегом
 *  место есть не всегда: сразу после `cond ? (` или `: (` JSX-комментарий поставить
 *  нельзя, это синтаксическая ошибка (проверено трижды). Тогда отметку пишут ВНУТРИ
 *  списка атрибутов, обычным `//`, и тег оказывается выше неё.
 *
 *  Три строки в обе стороны — это ширина списка атрибутов до `className`, но заведомо
 *  меньше расстояния до соседнего элемента. */
const excusedLines = (src) => {
  const out = new Map()
  src.split('\n').forEach((line, i) => {
    const m = OK_MARK.exec(line)
    if (!m) return
    const reason = m[1].replace(/\s*(\*\/|-->|\*\/\}|\}).*$/, '').trim()
    for (let k = i - 2; k <= i + 4; k++) if (k >= 1) out.set(k, reason)
  })
  return out
}

/** Активный сегмент: пара цветов ВНУТРИ ветки условия — `active ? 'bg-primary text-primary-fg' : …` */
const SEGMENT_ACTIVE = /\?\s*['"`][^'"`]*\bbg-primary\b[^'"`]*\btext-primary-fg\b/

const SHARED_RECIPE = /\b(buttonClass|cardClass|badgeClass|splitSegment)\(/

/**
 * ЛОКАЛЬНАЯ ОБЁРТКА НАД ОБЩИМ РЕЦЕПТОМ. В файле заводят помощник вида
 *   const pickCls = (on) => cardClass({ tone: on ? 'accent' : 'surface', … })
 * и зовут его из разметки. Вид у такой кнопки приходит ровно оттуда же, откуда у
 * примитива, — просто через один вызов. Считать её самопалом значит требовать
 * РАЗВЕРНУТЬ рецепт по трём местам, то есть чинить ровно наоборот.
 *
 * Ищем имена, объявленные в этом же файле, чьё тело зовёт общий рецепт. Одного
 * уровня хватает: обёртка над обёрткой в коде не встречается, а гнаться за ней
 * значит писать в счётчике свой резолвер и получить третий источник ошибок.
 */
const localRecipes = (code) => {
  const out = new Set()
  const re = /(?:const|function)\s+([A-Za-z_$][\w$]*)\s*(?:[:=(][^\n]*)?/g
  for (const m of code.matchAll(re)) {
    // Тело помощника — до следующего объявления верхнего уровня, но не длиннее
    // разумного: длинный хвост затянул бы чужой вызов рецепта и оправдал бы всё.
    if (SHARED_RECIPE.test(code.slice(m.index, m.index + 400))) out.add(m[1])
  }
  return out
}

const recipe = (attrs, local) =>
  SHARED_RECIPE.test(attrs) || [...local].some((n) => new RegExp(`\\b${n}\\(`).test(attrs))

const only = process.argv.slice(2).find((a) => !a.startsWith('--'))
const LIST = process.argv.includes('--list')
const JSON_OUT = process.argv.includes('--json')
const roles = ROLES.filter((r) => !only || r.key.includes(only))

const values = VALUES.filter((v) => !only || v.key.includes(only))
const a11y = A11Y.filter((v) => !only || v.key.includes(only))
const hits = new Map([...roles, ...values, ...a11y].map((r) => [r.key, []]))
/** Места, снятые отметкой: считаются и печатаются отдельно, чтобы не пропасть из виду. */
const marked = []

// Значения считаем и в .ts тоже: рецепты классов живут в константах (control.ts,
// button-style.ts, HERO_INPUT), и там разнобой прячется охотнее, чем в разметке.
for (const file of walkFiles(SRC, ['.tsx', '.ts'])) {
  const path = rel(file)
  const src = readFileSync(file, 'utf8')

  // Строки-комментарии выбрасываем: в них живут ПРИМЕРЫ значений («ловим text-[..px]»),
  // и без этого счётчик считал бы собственную документацию за нарушение. Убираем только
  // целиком-комментарные строки — вырезать хвостовые опасно, в коде есть «https://».
  const code = src
    // JSX-комментарий `{/* … */}` вырезаем ЦЕЛИКОМ, а не построчно: строка внутри него
    // начинается не со звёздочки, а с обычного текста, и построчный фильтр её пропускал.
    // Из-за этого счётчик числил нарушением фразу «карточка сама <button>» — то есть
    // ОБЪЯСНЕНИЕ, почему интерактив вынесен наружу. Строки сохраняем, чтобы номера
    // в отчёте продолжали совпадать с файлом.
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l))
    .join('\n')

  // Рецепт в константе файла: ищем по составу классов у объявления.
  for (const rule of roles.filter((r) => r.recipe)) {
    const re = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:\([^)]*\)\s*=>\s*)?[`'"]([^`'"]{20,})[`'"]/g
    for (const m of code.matchAll(re)) {
      const cls = m[2]
      const parts = [/rounded/, /(^|\s)(px-|py-|p-\d)/, /(^|\s)(border|bg-)/, /text-/].filter((x) => x.test(cls))
      if (parts.length >= 3 && !HOME.test(path))
        hits.get(rule.key).push({ path, line: code.slice(0, m.index).split('\n').length, tag: m[1] })
    }
  }

  for (const v of values) {
    v.re.lastIndex = 0
    for (const m of code.matchAll(v.re)) {
      if (!v.raw && COMPUTED.test(m[0])) continue
      hits.get(v.key).push({ path, line: src.slice(0, m.index).split('\n').length, tag: m[0] })
    }
  }

  if (!path.endsWith('.tsx')) continue
  const local = localRecipes(code)
  // Отметки читаем из ИСХОДНОГО текста: выше их вырезали вместе с комментариями.
  const excused = excusedLines(src)
  // Разбираем ТОТ ЖЕ текст без комментариев: в док-блоках примитивов живут примеры
  // разметки («<input type="date">», «<button …>»), и без этого счётчик считал бы
  // документацию за нарушение — на первом же прогоне так и вышло.
  for (const el of tags(code)) {
    // Доступность считается ВЕЗДЕ, включая shared/ui: у примитива безымянная кнопка —
    // это не «работа примитива», а та же немая кнопка, только размноженная.
    for (const rule of a11y) {
      if (rule.check({ ...el, inner: rule.key === 'значок без имени' ? innerOf(code, el) : '', before: code.slice(Math.max(0, el.index - 400), el.index) }))
        hits.get(rule.key).push({ path, line: el.line, tag: el.tag })
    }
    if (HOME.test(path)) continue
    const cls = classesOf(el.attrs)
    for (const role of roles) {
      if (!role.match({ ...el, cls, local })) continue
      const why = excused.get(el.line)
      if (why && why.length >= 20) {
        marked.push({ path, line: el.line, tag: el.tag, key: role.key, why })
        continue
      }
      // Отметка без внятной причины НЕ освобождает: пусть лучше место останется в
      // долге, чем в коде заведётся способ гасить счётчик словом «ok».
      hits.get(role.key).push({ path, line: el.line, tag: el.tag })
    }
  }
}

if (JSON_OUT) {
  // Ключи сортируем: слепок читают глазами в дифференциале, и порядок обхода каталогов
  // не должен перетасовывать файл при каждом пересъёме.
  const out = {}
  for (const role of [...roles, ...values, ...a11y].sort((a, b) => a.key.localeCompare(b.key, 'ru'))) {
    const byFile = {}
    for (const h of hits.get(role.key)) byFile[h.path] = (byFile[h.path] ?? 0) + 1
    out[role.key] = Object.fromEntries(Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b)))
  }
  // Отметки едут в тот же слепок отдельной строкой: новая отметка обязана быть видна
  // в дифференциале как осознанный шаг, а не тихо гасить число.
  const byMark = {}
  for (const m of marked) byMark[m.path] = (byMark[m.path] ?? 0) + 1
  out['разобрано и законно'] = Object.fromEntries(Object.entries(byMark).sort(([a], [b]) => a.localeCompare(b)))
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
const c = table('\nНЕ ДОХОДИТ ДО ЧЕЛОВЕКА БЕЗ ЗРЕНИЯ\n', a11y, 'fix')
console.log(`\nвсего мест: ${a + b + c} (ролей ${a}, значений ${b}, доступности ${c})`)

// Разобранное печатаем ВСЕГДА, а не только под --list: смысл отметки в том, что решение
// видно, а не в том, что место исчезло. Число рядом с долгом — вторая половина картины.
if (marked.length) {
  console.log(`\nРАЗОБРАНО И ПРИЗНАНО ЗАКОННЫМ: ${marked.length}`)
  for (const m of marked) console.log(`      ${m.path}:${m.line} ${m.tag} — ${m.why}`)
}

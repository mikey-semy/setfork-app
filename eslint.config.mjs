import next from 'eslint-config-next'
import boundaries from 'eslint-plugin-boundaries'

// Flat-config для ESLint 9 / Next 16 (eslint-config-next — готовый flat-массив).
// Экспериментальные react-compiler-правила Next 16 приглушены до warn: они агрессивно
// флагают валидные паттерны (guard-эффекты, запись cookie); чистка под них — отдельная задача.
// Запреты синтаксиса живут КОНСТАНТОЙ, потому что flat-config заменяет запись
// правила целиком: блок ниже, добавляющий узду карточки для кода вне shared/ui,
// обязан перечислить и все остальные — иначе фичи молча теряют i18n-барьер и
// прочее (поймано `eslint --print-config` при разведении правил по областям).
const RESTRICTED = [
        {
          selector: 'ConditionalExpression:matches([consequent.value=/[а-яА-ЯёЁ]/], [alternate.value=/[а-яА-ЯёЁ]/])',
          message:
            'Двуязычную строку из тернарника вынеси в словарь i18n (t()/tr() из @/shared/i18n): третий язык не должен требовать правки 100+ файлов. Технический литерал (не UI) — оставь // eslint-disable-next-line no-restricted-syntax.',
        },
        // Ф3 трека i18n-extraction: локальные say-хелперы и tr с инлайновыми
        // литералами были легальным обходом тернарного правила — после экстракции
        // (fe#646+) оба запрещены: строка живёт в dict/en.ts + dict/ru.ts.
        {
          selector: "VariableDeclarator[id.name='say']",
          message:
            'Локальный say(en, ru) запрещён (трек i18n-extraction, Ф3): добавь ключ в shared/i18n/dict/en.ts + ru.ts и используй t(key, lang). Плейсхолдеры — {n}/{a}/{b} + .replace().',
        },
        {
          // Property-селектор, а не properties.0: литерал ловится в ЛЮБОЙ позиции
          // объекта — tr({ en: value, ru: 'литерал' }) тоже запрещён (Codex #650).
          selector: "CallExpression[callee.name='tr'] > ObjectExpression > Property:matches([value.type='Literal'], [value.type='TemplateLiteral'])",
          message:
            'tr({ en: …, ru: … }) с инлайновыми литералами запрещён (трек i18n-extraction, Ф3): строка должна жить в словаре dict/. tr() — только для LocaleText-КОНТЕНТА из данных.',
        },
        // «У нас shadcn строго» (владелец, 2026-07-21, повторно): браузерные
        // формоэлементы запрещены — только shared/ui (Radix). Radix сам рендерит
        // скрытый нативный select для форм — правило ловит лишь НАШ JSX.
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Браузерный <select> запрещён — используй Select из @/shared/ui/select (shadcn/Radix, name для форм поддерживается).',
        },
        // Узда Ф7: кегли — только лестница ролей (11/12/12.5/13/14/16/18, control.ts
        // TEXT) и герои ≥20px (включая дробные и трёхзначные). Полупиксельный
        // зоопарк (Ф5) не должен вернуться. Легитимное исключение (герой-пара к
        // SearchField lg) — точечный disable. ⚠️ Счётные суппрессии общие по
        // файлу на rule id: в файле с i18n-baseline обмен «тернарник → кегль»
        // может проскочить; кнопочная узда поэтому живёт ОТДЕЛЬНЫМ правилом
        // react/button-has-type ниже (находка Codex по #622).
        // С Ф6 все размеры в rem (px→rem кодмод, масштаб через корневой
        // font-size): текстовый кегль в px запрещён целиком, а из rem запрещены
        // конверсии старого зоопарка (0.5625=9px … 1.1875=19px, кроме ступеней
        // лестницы). Герои ≥1.25rem (20px+) свободны.
        {
          selector: 'Literal[value=/text-\\u005B\\d+(\\.\\d+)?px\\u005D|text-\\u005B(0\\.5625|0\\.59375|0\\.625|0\\.65625|0\\.71875|0\\.84375|0\\.90625|0\\.9375|1\\.0625|1\\.1875)rem\\u005D/]',
          message: 'Кегль вне лестницы ролей (rem-ступени 0.6875/0.75/0.78125/0.8125/0.875/1/1.125 + герои ≥1.25rem; px запрещён — размеры в rem ради настройки масштаба) — возьми роль из shared/ui/control.ts (TEXT).',
        },
        {
          selector: 'TemplateElement[value.cooked=/text-\\u005B\\d+(\\.\\d+)?px\\u005D|text-\\u005B(0\\.5625|0\\.59375|0\\.625|0\\.65625|0\\.71875|0\\.84375|0\\.90625|0\\.9375|1\\.0625|1\\.1875)rem\\u005D/]',
          message: 'Кегль вне лестницы ролей (rem-ступени 0.6875/0.75/0.78125/0.8125/0.875/1/1.125 + герои ≥1.25rem; px запрещён — размеры в rem ради настройки масштаба) — возьми роль из shared/ui/control.ts (TEXT).',
        },
        // Узда единой ширины (решение владельца 02.08.2026): рамка страницы —
        // центрированный блок с максимальной шириной И собственными полями. Их
        // было девять разных (1180…720) плюс четыре внутри админки, контент
        // прыгал при каждом переходе. Ловим сочетание mx-auto + w-full +
        // max-w-[..] + px/py; центрированные блоки ВНУТРИ страницы (карточка,
        // колонка формы) под него не попадают — у них нет всех четырёх.
        {
          selector:
            'Literal[value=/(?=\\u005B\\s\\S\\u005D*mx-auto)(?=\\u005B\\s\\S\\u005D*w-full)(?=\\u005B\\s\\S\\u005D*max-w-\\u005B)(?=\\u005B\\s\\S\\u005D*\\bp\\u005Bxy\\u005D-)/]',
          message: 'Своя ширина страницы запрещена — рамка одна на весь сайт: PAGE (или PAGE_X без вертикальных полей) из @/shared/ui/control. Читаемая колонка внутри страницы — PAGE_COLUMN.',
        },
        {
          selector:
            'TemplateElement[value.cooked=/(?=\\u005B\\s\\S\\u005D*mx-auto)(?=\\u005B\\s\\S\\u005D*w-full)(?=\\u005B\\s\\S\\u005D*max-w-\\u005B)(?=\\u005B\\s\\S\\u005D*\\bp\\u005Bxy\\u005D-)/]',
          message: 'Своя ширина страницы запрещена — рамка одна на весь сайт: PAGE (или PAGE_X без вертикальных полей) из @/shared/ui/control. Читаемая колонка внутри страницы — PAGE_COLUMN.',
        },
        // ── Узда высоты контролов (замер 13.08.2026) ───────────────────────────
        // Шкала жила в control.ts, но её обходили ДВУМЯ способами, и оба дали по
        // ряду разной высоты: 26 мест брали примитив и тут же перебивали ему
        // высоту классом (`<Button className="h-10">`), ещё 29 рисовали кнопку
        // руками из `h-8 rounded-md border`. Вторые не получали и тач-цель 44px
        // (TOUCH_MIN_H живёт в buttonClass) — на телефоне «Получить» была 32px
        // рядом с 44px-веткой, что владелец и увидел. Оба способа теперь запрещены.
        //
        // Роли выше md нет? Её надо ДОБАВИТЬ в шкалу (так появилась lg), а не
        // обойти классом: иначе одна и та же роль снова расползётся по числам.
        {
          selector:
            "JSXOpeningElement[name.name=/^(Button|IconButton|Input|Textarea|SearchField|SelectTrigger|SubmitButton|FloatingInput)$/] JSXAttribute[name.name='className'] :matches(Literal[value=/(^|\\s|:)(min-)?h-\\d/], TemplateElement[value.cooked=/(^|\\s|:)(min-)?h-\\d/])",
          message:
            'Высота примитива задаётся ТОЛЬКО пропом size (xs/sm/md/lg из shared/ui/control.ts), а не классом h-*. Нужна другая высота — добавь ступень в шкалу, иначе роль расползётся по числам.',
        },
        {
          // ⚠️ Классов символов тут быть НЕ МОЖЕТ: `[` ломает разбор селектора, а
          // приём `[` из правил выше означает ЛИТЕРАЛЬНУЮ скобку (он для того
          // и заведён — ловить `text-[13px]`), а не «любой символ». Первая версия
          // этого правила была написана с `[\s\S]*` и молча не срабатывала
          // вовсе. Поэтому «что угодно между» — через `(?:.|\s)*`.
          selector:
            "JSXOpeningElement[name.name=/^(button|a)$/] JSXAttribute[name.name='className'] :matches(Literal[value=/(^|\\s)h-\\d(?:.|\\s)*rounded-md|rounded-md(?:.|\\s)*\\sh-\\d/], TemplateElement[value.cooked=/(^|\\s)h-\\d(?:.|\\s)*rounded-md|rounded-md(?:.|\\s)*\\sh-\\d/])",
          message:
            'Рукописная кнопка (h-* + rounded-md) не получает ни шкалы, ни тач-цели 44px. Возьми Button/IconButton или buttonClass() из @/shared/ui/button-style — вид, высота и фокус придут оттуда.',
        },
        // ── Контрол БЕЗ высоты (её считает padding) ────────────────────────────
        // Дыра, через которую прошли все жалобы владельца 13.08.2026: узда выше
        // требует h-* вместе с rounded-md, а самые кривые места высоты НЕ ИМЕЮТ
        // ВОВСЕ. Кнопка «Отправить тест» в SMTP — `px-3.5 py-2` без высоты: 8+8
        // отступы + строка + рамки = 38px рядом с полем 32px. Замер: 71 такое
        // место в 47 файлах, и ни одно из них счётчик не видел.
        //
        // Высота контрола приходит ИЗ ШКАЛЫ, а не из арифметики отступов: иначе
        // соседи в ряду совпадают только случайно.
        {
          selector:
            "JSXOpeningElement[name.name=/^(button|input|a|select|textarea|Link)$/] JSXAttribute[name.name='className'] :matches(Literal[value=/rounded-(?:.|\\s)*(?:^|\\s)py?-(?:0\\.5|[1-9])|(?:^|\\s)py?-(?:0\\.5|[1-9])(?:.|\\s)*rounded-/], TemplateElement[value.cooked=/rounded-(?:.|\\s)*(?:^|\\s)py?-(?:0\\.5|[1-9])|(?:^|\\s)py?-(?:0\\.5|[1-9])(?:.|\\s)*rounded-/])",
          message:
            'Высоту контрола задаёт padding — значит она совпадёт с соседями только случайно. Возьми Button/IconButton/Input (или buttonClass) из shared/ui: высота придёт из шкалы control.ts. Не контрол (строка меню, ячейка, обёртка) — точечный disable с причиной.',
        },

]

// Узда карточки: внутри shared/ui рамка+фон+отступ — это работа примитива
// (SettingsSection, PageAside, dropdown-menu, DataTableV2…), запрещать нечего.
const CARD_RULE = // ── Узда карточки (Ф13, замер 13.08.2026) ─────────────────────────────
        // Примитива под роль «рамка + фон + отступ» не было вовсе, поэтому её
        // писали руками: 35 рецептов в 94 местах, семь внутренних отступов на
        // одну роль. Теперь рецепт один — cardClass из @/shared/ui/card-style.
        //
        // Без классов символов: `[` ломает разбор селектора, а [ значит
        // ЛИТЕРАЛЬНУЮ скобку. «Что угодно между» — только (?:.|\s)*.
        {
          selector:
            "JSXAttribute[name.name='className'] :matches(Literal[value=/rounded-(?:.|\\s)*\\sborder(?:.|\\s)*\\sp-\\d|(?:^|\\s)p-\\d(?:.|\\s)*\\srounded-(?:.|\\s)*\\sborder/], TemplateElement[value.cooked=/rounded-(?:.|\\s)*\\sborder(?:.|\\s)*\\sp-\\d|(?:^|\\s)p-\\d(?:.|\\s)*\\srounded-(?:.|\\s)*\\sborder/])",
          message:
            'Карточка (рамка + фон + внутренний отступ) рисуется ТОЛЬКО через cardClass из @/shared/ui/card-style: tone задаёт смысл блока, pad — ступень отступа. Нужен новый тон или ступень — добавь в примитив, а не рядом с ним. Роль не карточка (обводка-группировка, рамка картинки, сегментированный контрол) — точечный disable с причиной.',
        }

export default [
  { ignores: ['.next/**', 'node_modules/**', 'src/shared/gen/**', 'drizzle/**', 'public/**', '.claude/**'] },
  ...next,
  {
    rules: {
      // preview react-compiler набор (Next 16) — агрессивен на валидных паттернах; держим как warn.
      'react-hooks/immutability': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      // Барьер видимости: сырые getListMeta/getTemplateDetail отдают данные БЕЗ canViewList.
      // Забытый гейт = утечка приватного/черновика/снятого модерацией (так родились дыры
      // blame/versions/insights/suggest). Чтение списка идёт ТОЛЬКО через чокпоинт guard.ts.
      // guard.ts импортит из relative './queries' и правилом не задевается (это его законный дом).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/features/library/queries',
              importNames: ['getListMeta', 'getTemplateDetail'],
              message:
                'Сырой загрузчик не гейтит видимость. Используй requireViewableMeta/requireViewableDetail из @/features/library/guard. Иная модель доступа (анонимный isPubliclyVisible, owner-only, git/MCP-скоуп) — оставь // eslint-disable-next-line no-restricted-imports с причиной.',
            },
          ],
        },
      ],
      // i18n-барьер: инлайновый двуязычный тернарник (кириллица в ветке) = строка мимо
      // словаря. 696 таких в 129 файлах заморожены в baseline (eslint-suppressions.json);
      // НОВЫЕ — ошибка. Чинишь старые → `npx eslint . --prune-suppressions`. Ложняков нет:
      // кириллица в литерале тернарника — это почти всегда UI-текст.
      'no-restricted-syntax': ['error', ...RESTRICTED],
      // Узда Ф7: <button> без явного type в форме сабмитит её случайно (дефолт
      // submit). Отдельным rule id (не no-restricted-syntax) — чтобы счётные
      // суппрессии i18n-baseline не маскировали кнопочные грехи (Codex #622).
      'react/button-has-type': ['error', { button: true, submit: true, reset: true }],
    },
  },
  // ── Архитектурные границы слоёв (аудит 2026-07-08) ─────────────────────────
  // Направление зависимостей: app → widgets → features → { core, shared }.
  // Фичи не видят друг друга; core не видит никого; shared не видит фичи.
  // Существующие нарушения заморожены в eslint-suppressions.json (baseline):
  // НОВЫЕ кросс-импорты — ошибка сразу; починил старое — запусти
  // `npx eslint . --prune-suppressions`, чтобы усушить baseline.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core' },
        { type: 'shared', pattern: 'src/shared' },
        // mcp и admin — delivery-поверхности (внешний API и админ-консоль над
        // всем продуктом, зеркала app/), а не фичи: им, как и app, можно
        // оркестрировать фичи. Идут ДО features/* — первый матч выигрывает.
        { type: 'mcp', pattern: 'src/features/mcp' },
        { type: 'admin', pattern: 'src/features/admin' },
        // Садовник — АВТОНОМНАЯ ПЕТЛЯ над библиотекой: своей предметной области у
        // него нет, есть только работа над чужой (пишет версии через list-store,
        // извещает через notifications, читает подписки через watch). Это тот же
        // слой оркестрации, что mcp и admin, только запускает его расписание, а не
        // запрос: у Gitea фоновые задачи живут в `services/cron` — рядом с тем, что
        // обслуживает HTTP, а не в слое домена; у Feature-Sliced Design оркестрация
        // нескольких фич принадлежит app (бывший слой processes), а не features.
        //
        // ПРИЗНАК, по которому сюда попадают (проверяемый, а не на вкус): каталог
        // никто не импортирует СНИЗУ — только реестр петель и instrumentation.
        // По этому же признаку кандидаты на следующий заход: linkcheck, digest,
        // backoffice, knowledge (замер 11.08: ноль импортёров у каждого).
        { type: 'gardener', pattern: 'src/features/gardener' },
        { type: 'features', pattern: 'src/features/*', capture: ['feature'] },
        { type: 'widgets', pattern: 'src/widgets' },
        { type: 'app', pattern: 'src/app' },
      ],
      'import/resolver': { typescript: {} },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            'Слой «{{ from.type }}» не должен импортировать «{{ to.type }}» (границы: app → widgets → features → core/shared)',
          policies: [
            // Внутри своего элемента (та же фича, свой слой) — можно всегда.
            { allow: { dependency: { relationship: { to: 'internal' } } } },
            { from: { type: 'shared' }, allow: { to: [{ type: 'core' }] } },
            // Фича видит только себя (internal выше) + core/shared — кросс-импорт фич запрещён.
            { from: { type: 'features' }, allow: { to: [{ type: 'shared' }, { type: 'core' }] } },
            { from: { type: 'widgets' }, allow: { to: [{ type: 'features' }, { type: 'shared' }, { type: 'core' }] } },
            { from: { type: 'mcp' }, allow: { to: [{ type: 'features' }, { type: 'shared' }, { type: 'core' }] } },
            { from: { type: 'admin' }, allow: { to: [{ type: 'features' }, { type: 'shared' }, { type: 'core' }] } },
            { from: { type: 'gardener' }, allow: { to: [{ type: 'features' }, { type: 'shared' }, { type: 'core' }] } },
            {
              from: { type: 'app' },
              allow: { to: [{ type: 'mcp' }, { type: 'admin' }, { type: 'gardener' }, { type: 'widgets' }, { type: 'features' }, { type: 'shared' }, { type: 'core' }] },
            },
          ],
        },
      ],
    },
  },
  // ── Узда карточки — ВНЕ shared/ui ─────────────────────────────────────────
  // Внутри shared/ui рамка+фон+отступ — это и есть работа примитива (SettingsSection,
  // PageAside, dropdown-menu, DataTableV2, BubbleToolbar…), запрещать там нечего.
  // Поэтому правило вынесено отдельным блоком с ignores, а не добавлено в общий
  // массив: иначе каждый примитив пришлось бы глушить точечным disable.
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/shared/ui/**'],
    rules: {
      'no-restricted-syntax': ['error', ...RESTRICTED, CARD_RULE],
    },
  },
]

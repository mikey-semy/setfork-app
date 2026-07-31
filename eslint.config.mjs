import next from 'eslint-config-next'
import boundaries from 'eslint-plugin-boundaries'

// Flat-config для ESLint 9 / Next 16 (eslint-config-next — готовый flat-массив).
// Экспериментальные react-compiler-правила Next 16 приглушены до warn: они агрессивно
// флагают валидные паттерны (guard-эффекты, запись cookie); чистка под них — отдельная задача.
export default [
  { ignores: ['.next/**', 'node_modules/**', 'src/shared/gen/**', 'drizzle/**', 'public/**'] },
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
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ConditionalExpression:matches([consequent.value=/[а-яА-ЯёЁ]/], [alternate.value=/[а-яА-ЯёЁ]/])',
          message:
            'Двуязычную строку из тернарника вынеси в словарь i18n (t()/tr() из @/shared/i18n): третий язык не должен требовать правки 100+ файлов. Технический литерал (не UI) — оставь // eslint-disable-next-line no-restricted-syntax.',
        },
        // «У нас shadcn строго» (владелец, 2026-07-21, повторно): браузерные
        // формоэлементы запрещены — только shared/ui (Radix). Radix сам рендерит
        // скрытый нативный select для форм — правило ловит лишь НАШ JSX.
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Браузерный <select> запрещён — используй Select из @/shared/ui/select (shadcn/Radix, name для форм поддерживается).',
        },
        // Узда Ф7: кегли — только лестница ролей (11/12.5/13/14/16/18, control.ts
        // TEXT) и герои ≥20px (включая дробные и трёхзначные). Полупиксельный
        // зоопарк (Ф5) не должен вернуться. Легитимное исключение (герой-пара к
        // SearchField lg) — точечный disable. ⚠️ Счётные суппрессии общие по
        // файлу на rule id: в файле с i18n-baseline обмен «тернарник → кегль»
        // может проскочить; кнопочная узда поэтому живёт ОТДЕЛЬНЫМ правилом
        // react/button-has-type ниже (находка Codex по #622).
        {
          selector: 'Literal[value=/text-\\u005B(?!(11|12\\.5|13|14|16|18|[2-9]\\d(\\.\\d+)?|\\d{3,}(\\.\\d+)?)px\\u005D)\\d+(\\.\\d+)?px\\u005D/]',
          message: 'Кегль вне лестницы ролей (11/12.5/13/14/16/18 + герои ≥20) — возьми роль из shared/ui/control.ts (TEXT) или ближайшую ступень.',
        },
        {
          selector: 'TemplateElement[value.cooked=/text-\\u005B(?!(11|12\\.5|13|14|16|18|[2-9]\\d(\\.\\d+)?|\\d{3,}(\\.\\d+)?)px\\u005D)\\d+(\\.\\d+)?px\\u005D/]',
          message: 'Кегль вне лестницы ролей (11/12.5/13/14/16/18 + герои ≥20) — возьми роль из shared/ui/control.ts (TEXT) или ближайшую ступень.',
        },
      ],
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
            {
              from: { type: 'app' },
              allow: { to: [{ type: 'mcp' }, { type: 'admin' }, { type: 'widgets' }, { type: 'features' }, { type: 'shared' }, { type: 'core' }] },
            },
          ],
        },
      ],
    },
  },
]

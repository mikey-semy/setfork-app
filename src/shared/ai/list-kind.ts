import { listLaw } from './list-laws'
/**
 * Тип списка (ADR-0010): ПЕРВИЧНОЕ решение генерации — что является ЭЛЕМЕНТОМ, и потому какой формы
 * должен быть вывод. Раньше движок всегда делал процедуру («6-9 ordered steps: short imperative»), и
 * запрос «конкретные аксессуары к VR-шлему: чехлы, сумка, аккумуляторы» возвращал процедуру
 * («Определите → Исследуйте → Выберите») вместо СПИСКА ВЕЩЕЙ. По Diátaxis — перепутана ось: выдан
 * action (что делать) там, где просили cognition (что существует).
 *
 * Пять типов покрывают почти все реальные запросы (композиция Diátaxis + DITA + Information Mapping +
 * Gawande + BOM; канонической таксономии списков не существует). Структура JSON та же (CandidateItem
 * переиспользуется) — меняется СМЫСЛ элемента, задаваемый инструкцией shapeFor().
 */
export type ListKind = 'procedure' | 'inventory' | 'checklist' | 'criteria' | 'options' | 'recipe'

export const LIST_KINDS: ListKind[] = ['procedure', 'inventory', 'checklist', 'criteria', 'options', 'recipe']

/** Человеческая подпись типа — для переключателя в чате (Ф-Т2). en/ru аргументами (i18n-lint). */
export function kindLabel(kind: ListKind, ru: boolean): string {
  const L: Record<ListKind, [en: string, ru: string]> = {
    procedure: ['Steps', 'Пошагово'],
    inventory: ['Things to get', 'Список вещей'],
    checklist: ['Checklist', 'Чеклист'],
    criteria: ['Criteria', 'Критерии выбора'],
    options: ['Options', 'Варианты'],
    recipe: ['Recipe', 'Рецепт'],
  }
  const [en, rus] = L[kind]
  return ru ? rus : en
}

/**
 * Проставить секции рецепту, если модель их не заполнила (gpt-4o-mini стабильно игнорирует поле
 * section даже с жёстким промптом). Структура надёжна: ингредиенты с «Название — количество» идут
 * ПРЕФИКСОМ, первый императивный шаг без тире-развесовки открывает готовку. Латч inSteps: попали в
 * готовку — остаёмся, даже если у шага случайно есть тире. Промах безопасен: без секций карточка
 * просто рисует плоский список, как раньше.
 */
export function backfillRecipeSections(items: { title: string; section?: string }[], ru: boolean): void {
  if (items.some((it) => it.section)) return // модель проставила — уважаем
  const [ING, STEP] = ru ? (['Ингредиенты', 'Приготовление'] as const) : (['Ingredients', 'Preparation'] as const)
  let inSteps = false
  for (const it of items) {
    if (!inSteps && /\s[—–-]\s/.test(it.title)) it.section = ING
    else {
      inSteps = true
      it.section = STEP
    }
  }
}

/** Пример для поля «дополнить» — ПО ТИПУ списка и НЕЙТРАЛЬНО К ТЕМЕ: «побольше про
 *  безопасность» смотрелось нелепо на списке фантастики (фидбек владельца) — примеры
 *  теперь про СТРУКТУРУ списка, а не предметную область.
 *  kind — свободная строка из БД (list_kind), невалидное молча падает на procedure. */
export function refineHint(kind: string | null, ru: boolean): string {
  const H: Record<ListKind, [en: string, ru: string]> = {
    procedure: ['add a missing step', 'добавь недостающий шаг'],
    inventory: ['add a couple more items', 'добавь ещё пару пунктов'],
    checklist: ['add a missing check', 'добавь недостающую проверку'],
    criteria: ['add an important criterion', 'добавь важный критерий'],
    options: ['add one more option', 'добавь ещё вариант'],
    recipe: ['make it for 2 servings', 'пересчитай на 2 порции'],
  }
  const [en, rus] = H[(kind as ListKind) in H ? (kind as ListKind) : 'procedure']
  return ru ? rus : en
}

/**
 * Грамматический классификатор по запросу: дёшево, детерминированно, мгновенно, без вызова модели.
 * Это НЕ окончательный решатель (по ADR — priors): совет может переопределить своим LLM-классификатором
 * (распорядитель и так классифицирует, добавить поле стоит ~0), а eval-набор (Ф-Т3) покажет, где
 * грамматики не хватает. Промах в сторону 'procedure' безопасен — это прежнее поведение.
 *
 * Порядок проверок = приоритет: сначала самые однозначные сигналы. Слова — на языках, на которых пишут.
 */
// Флаг `u` + \p{L} для границ: JS `\b` работает ТОЛЬКО с ASCII — `\bаксессуар` не матчит кириллицу
// вовсе (буква = не-word-символ для \b). Поэтому «край слова» задаём как (?<![\p{L}]) / (?![\p{L}]).
const A = '(?<![\\p{L}])' // нет буквы слева
const Z = '(?![\\p{L}])' //  нет буквы справа
const SIGNALS: { kind: ListKind; re: RegExp }[] = [
  // Список вещей: «аксессуары/что нужно/что взять/комплект/снаряжение…».
  {
    kind: 'inventory',
    re: new RegExp(`${A}(аксессуар|что\\s+(нужно|взять|купить|необходим|брать)|список\\s+(вещей|покупок|товаров)|комплект|снаряжени|инвентар|оборудовани|что\\s+входит|packing\\s+list|shopping\\s+list|what\\s+to\\s+(buy|pack|bring)|gear\\s+for|accessories|supplies|equipment\\s+for)`, 'iu'),
  },
  // Чеклист-контроль: «что проверить/не забыть/перед выездом» — состояния, не действия.
  {
    kind: 'checklist',
    re: new RegExp(`${A}(что\\s+проверить|не\\s+забыть|перед\\s+(выездом|запуском|поездкой|стартом|деплоем)|checklist\\s+before|before\\s+you\\s+(go|launch|deploy)|don'?t\\s+forget|things\\s+to\\s+check)`, 'iu'),
  },
  // Варианты/сравнение: «что лучше/X или Y/топ/сравнение».
  {
    kind: 'options',
    re: new RegExp(`${A}(что\\s+лучше|что\\s+выбрать|лучшие|топ[\\s-]?\\d|сравнени|which\\s+is\\s+better|best\\s+\\w+\\s+(for|to)|top\\s+\\d|compare)${Z}|${A}(vs|или)${Z}`, 'iu'),
  },
  // Критерии выбора: «как выбрать/на что смотреть/критерии».
  {
    kind: 'criteria',
    re: new RegExp(`${A}(как\\s+выбрать|на\\s+что\\s+(смотреть|обратить)|критери|как\\s+не\\s+ошибиться|what\\s+to\\s+look\\s+for|how\\s+to\\s+choose|criteria\\s+for)`, 'iu'),
  },
]

export function classifyListKind(query: string): ListKind {
  // Рецепт — ПЕРВЫМ: он не чистая процедура, а ингредиенты (inventory) + готовка (procedure).
  // Классифицировали бы как procedure — терялись бы ингредиенты (провал «Рецепт маршмеллоу»).
  // Детект слов рецепта переиспользуем из list-laws, чтобы не держать два списка.
  if (listLaw(query)?.id === 'recipe') return 'recipe'
  const q = query.toLowerCase()
  for (const { kind, re } of SIGNALS) if (re.test(q)) return kind
  return 'procedure' // дефолт — прежнее поведение, безопасный промах
}

/**
 * Блок инструкции для промпта: ЧТО является элементом при данном типе. Структура JSON не меняется —
 * переиспользуем поля CandidateItem (title/desc/command/level/why/subtasks/refs) с иным СМЫСЛОМ.
 * Вставляется в JSON_SHAPE вместо жёсткого «ordered steps: imperative».
 */
export function shapeFor(kind: ListKind): string {
  switch (kind) {
    case 'inventory':
      return `LIST TYPE: INVENTORY — a list of THINGS to get/have, NOT actions.
- Each item is a physical thing. title = "<name> — <amount/spec>" (e.g. "Чехол для линз — 1 шт", "Powerbank 10000 мА·ч — 1-2 шт"). A title without the thing's name/amount is WRONG.
- desc = why it is needed or what to look for when buying. command = "" always. refs = where to buy / product page.
- level = required (must-have) / recommended / optional (nice-to-have). Group related items; order is NOT a sequence to perform.
- NEVER write procedure meta-steps like "Определите/Исследуйте/Выберите/Купите" — those are actions, not things. The user wants the THINGS themselves.`
    case 'checklist':
      return `LIST TYPE: CHECKLIST — verifiable STATES to confirm (Gawande do-confirm), NOT actions to perform.
- Each item is a checkable state. title = a state phrase ("Резервная копия создана", "Паспорт действителен ≥6 мес"), not "Сделай X".
- desc = how to verify it. command = "" unless a real verification command. level = required/recommended.`
    case 'criteria':
      return `LIST TYPE: CRITERIA — RULES/criteria for choosing or judging, NOT steps.
- Each item is a rule or criterion. title = the rule ("Матрица не ниже 20 ppd — иначе текст мылит"). why = the rationale behind it. command = "".
- Order by importance (most decisive first).`
    case 'options':
      return `LIST TYPE: OPTIONS — concrete OPTIONS to compare, NOT steps.
- Each item is one option. title = the option's name. desc = its key trade-off (what it's good at, what it costs/lacks). refs = its page. command = "".
- Order by fit for a typical user.`
    case 'recipe':
      return `LIST TYPE: RECIPE — TWO groups. The "section" field is MANDATORY on EVERY item and has exactly one of two literal values:
- Ingredients come FIRST, each with section EXACTLY "Ингредиенты" (English: "Ingredients"). title = "<ingredient> — <amount>" with an exact amount ("Сахар — 400 г", "Желатин — 15 г", "Вода — 200 мл"). An ingredient without an amount is WRONG. desc = short prep note ("замочить на 10 мин") or "". command = "".
- Cooking steps come AFTER, each with section EXACTLY "Приготовление" (English: "Preparation"). title = short imperative. desc = detail with timings and temperatures. command = "".
- If you leave "section" empty on a recipe item, the output is WRONG. Use as many items as the recipe needs.`
    case 'procedure':
    default:
      return `LIST TYPE: PROCEDURE — an ordered how-to. The reader DOES each step in order.
- items: 4-12 ordered steps. title = short imperative verb phrase. desc = one or two clarifying sentences.
- command = a real runnable TERMINAL command ONLY for technical steps literally typed into a shell (e.g. "npm install"); "" for non-technical. Never restate the title as a fake command, never wrap a URL in curl.
- refs = 0-3 helpful links. level = how essential. why = one sentence why it matters. subtasks = 0-3 verification checks.`
  }
}

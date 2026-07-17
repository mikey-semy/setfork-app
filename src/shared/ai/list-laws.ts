/**
 * Законы типов списков: жёсткая ФОРМА результата для домена. Это не persona гнома (та про манеру)
 * и не совет — закон обязан действовать всегда, иначе однообразия не будет.
 *
 * Почему не на гноме: «Гороховый суп» распорядитель честно считает простой темой и идёт одиночной
 * генерацией — повара никто не зовёт, и его закон не применяется. Закон живёт на ТИПЕ СПИСКА.
 *
 * Определяем по ключевым словам: дёшево, детерминированно и без лишнего вызова модели. Промах в
 * сторону «закона нет» безопасен — список просто останется обычным.
 */

export interface ListLaw {
  id: string
  /** Слова-триггеры (по вхождению, регистр не важен) — на языках, на которых пишут запросы. */
  words: string[]
  /** Требование к структуре. Уходит и в черновики, и в синтез, и в одиночную генерацию. */
  rule: string
}

const RECIPE: ListLaw = {
  id: 'recipe',
  words: [
    'рецепт', 'суп', 'борщ', 'салат', 'пирог', 'выпеч', 'испечь', 'приготов', 'блюд', 'соус', 'десерт',
    'завтрак', 'ужин', 'обед', 'тесто', 'котлет', 'запеч', 'мариновать', 'бульон', 'каша', 'плов',
    'recipe', 'soup', 'salad', 'cake', 'bake', 'baking', 'cook', 'dish', 'sauce', 'dessert', 'dough', 'stew',
  ],
  // Формулировка выстрадана прогоном: с мягким «each with an exact amount» модель ставила шаг
  // «Горох сухой», а в desc писала «используйте качественный горох» — развесовка пропадала.
  // Поэтому требуем количество ИМЕННО в title и прямо запрещаем совет вместо цифры.
  rule: `MANDATORY SHAPE for a recipe list — it is a law, not a preference:
- The FIRST steps are the ingredients, one per step. The step TITLE MUST carry the amount in the
  form "<item> — <amount>": "Горох сухой — 400 г", "Морковь — 1 шт. (~90 г)", "Вода — 2.5 л".
  A title without a number is WRONG. Never bundle ingredients into one step.
- For an ingredient step, "desc" is a short prep/selection note ("замочить на ночь") or empty —
  NEVER advice like "используйте качественный горох", and never the amount (it lives in the title).
- Only AFTER all ingredients come the cooking steps, in order, with timings and temperatures.
- Never hide an amount inside a cooking step — every amount lives in its ingredient step.
- Use as many steps as the ingredients require: this overrides any "6-9 steps" guidance.`,
}

const LAWS: ListLaw[] = [RECIPE]

/** Закон для запроса, или null. Первое совпадение выигрывает — законы не комбинируем. */
export function listLaw(query: string): ListLaw | null {
  const q = query.toLowerCase()
  return LAWS.find((l) => l.words.some((w) => q.includes(w))) ?? null
}

/** Готовый блок для промпта (пусто, если закона нет) — чтобы вызывающие не плодили шаблон. */
export function lawBlock(query: string): string {
  const law = listLaw(query)
  return law ? `\n\n${law.rule}` : ''
}

import { LIST_KINDS, classifyListKind, type ListKind } from './list-kind'
import { type Lang, type LocaleText } from '@/shared/i18n'

// Политики качества садовника ПО ТИПУ СПИСКА (ось B «живые списки»).
// Инсайт владельца: рецепту не нужен ассистент, но нужна точность («посолить
// на глаз» → граммовки), технической процедуре — актуальность команд/версий.
// Всё чистое (без БД/сети) — юнит-тестируется; override политик приходит
// параметром (читается из app_settings ключей gardener.policy.<kind>).

/** Базовая инструкция садовника — общая для всех типов. */
export const GARDENER_BASE_INSTRUCTION =
  'You are the site gardener improving a community list. ' +
  'Clarify vague steps, add missing verification sub-tasks, add a short "why" where the reason is non-obvious, ' +
  'and fix factual or ordering issues. Keep the author’s voice and structure. ' +
  'The language of the list is part of the author’s voice: NEVER translate the list into another language — translation is not an improvement. ' +
  'Add at most 2 new steps and do not remove existing ones unless clearly wrong.'

/** Код-дефолты политик. Главное правило всех политик: НЕ ВЫДУМЫВАТЬ ФАКТЫ —
 *  неуверенность оформляется вопросом автору (why), а не утверждением. */
const POLICIES: Record<ListKind, string> = {
  recipe:
    'RECIPE POLICY: Replace vague amounts ("на глаз", "по вкусу", "a pinch" on STRUCTURAL ingredients — flour, sugar, gelatin, liquids) ' +
    'with a typical amount marked "~" (e.g. "Соль — ~5 г (было: по вкусу)"), keeping the author’s original wording in desc. ' +
    'NEVER invent amounts for unusual or regional ingredients — instead set why to a question for the author (e.g. "уточните количество"). ' +
    'Add temperatures and timings to cooking steps ONLY when they are standard for the technique. Seasoning-to-taste at the END of cooking is fine — leave it.',
  procedure:
    'PROCEDURE POLICY: Check commands and tool versions for deprecated flags, renamed packages and outdated services. ' +
    'Do NOT invent version numbers — if unsure, phrase the step as "проверьте актуальную версию" in desc. ' +
    'Fix step ordering; add verification sub-tasks after risky steps.',
  checklist:
    'CHECKLIST POLICY: Every item must be a verifiable STATE, not an action. Add at most 2 missing critical checks. ' +
    'Make vague checks concrete (what exactly to look at).',
  inventory:
    'INVENTORY POLICY: Make specs concrete (capacity, size, count) where commonly standard; do NOT invent prices. ' +
    'Items stay THINGS — never turn them into actions.',
  criteria:
    'CRITERIA POLICY: Sharpen each rule to be decidable (a reader can check it). Strengthen why with the consequence of ignoring the rule. Do NOT invent numbers.',
  options:
    'OPTIONS POLICY: Sharpen trade-offs (what each option is best/worst at). Do NOT invent prices or availability — if unsure, ask in why.',
}

/** Инструкция свипа: база + политика типа (+ админ-override поверх кода). */
export function policyFor(kind: ListKind, overrides: Partial<Record<ListKind, string>> = {}): string {
  const policy = overrides[kind]?.trim() || POLICIES[kind]
  return `${GARDENER_BASE_INSTRUCTION}\n${policy}`
}

/** Ключ app_settings для override политики типа. */
export const policySettingKey = (kind: ListKind) => `gardener.policy.${kind}`
export const POLICY_SETTING_KEYS = LIST_KINDS.map(policySettingKey)

/** Язык ФАКТИЧЕСКОГО текста — по алфавиту, а не по ключам LocaleText.
 *  Ключ врёт: createTemplate кладёт текст под язык ИНТЕРФЕЙСА автора, поэтому
 *  русский список при en-интерфейсе хранится под 'en'. Прежний dominantLang
 *  считал ключи и садовник «улучшал» такие списки переводом на английский.
 *  Кириллица ≥ трети букв → ru: технические списки полны латинских команд и
 *  терминов, треть — достаточный сигнал. Расширение LOCALES потребует
 *  настоящей детекции, пока алфавитов два. */
export function textLang(texts: (string | null | undefined)[]): Lang {
  let cyr = 0
  let lat = 0
  for (const v of texts) {
    if (!v) continue
    cyr += (v.match(/[а-яё]/gi) ?? []).length
    lat += (v.match(/[a-z]/gi) ?? []).length
  }
  return cyr > 0 && cyr >= (cyr + lat) / 3 ? 'ru' : 'en'
}

/** То же для мультиязычного контента: смотрим значения ВСЕХ ключей. */
export function dominantLang(texts: (LocaleText | null | undefined)[]): Lang {
  return textLang(texts.flatMap((t) => (t ? Object.values(t) : [])))
}

/** Тип списка по структуре (дешёвая эвристика для ленивого бэкфилла
 *  templates.listKind): секции-«Ингредиенты» → recipe; команды → procedure;
 *  иначе — грамматический классификатор по заголовку. */
export function inferListKind(input: { title: string; sections: string[]; commandCount: number }): ListKind {
  const secRe = /^(ингредиенты|ingredients)$/i
  if (input.sections.some((s) => secRe.test(s.trim()))) return 'recipe'
  if (input.commandCount >= 2) return 'procedure'
  return classifyListKind(input.title)
}

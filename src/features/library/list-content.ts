import type { ListContent } from '@/core'
import type { ProposedItem } from '@/shared/db'
import { tr, type Lang, type LocaleText } from '@/shared/i18n'

/**
 * Блоки списка (доменная форма с LocaleText) → СОДЕРЖИМОЕ версии для ядра.
 *
 * Ядро — единственный владелец формата: оно соберёт из этого канон `list.json`.
 * Здесь только приведение формы, и оно ОДНО на все пути: правка предложения в
 * ветке, показ канона текстом, разбор правки как кода. Раньше эта раскладка жила
 * инлайном внутри экшена предложений — и была уже третьей копией конвертера шагов
 * в проекте.
 *
 * Язык. `list.json` одноязычный, поэтому двуязычный текст сводится к языку
 * читателя (`tr`). Обратная дорога кладёт текст в `en` — не как утверждение
 * «текст английский», а как единственную ветку LocaleText, куда его можно
 * положить (см. `snapshotSteps`).
 */
export function toListContent(
  items: ProposedItem[],
  meta: { title: string; desc: string; tags: string[]; ordered: boolean; version: number },
  lang: Lang,
): ListContent {
  return {
    ...meta,
    steps: items.map((it, i) => ({
      n: i + 1,
      // Блочная модель: type/content несут только НЕ-шаги.
      ...(it.type && it.type !== 'step' ? { type: it.type, content: (it.content ?? {}) as Record<string, unknown> } : {}),
      // Идентичность сквозь версии: без неё дифф читает переименование как
      // «удалён + добавлен» (ADR-0013).
      ...(it.blockId ? { blockId: String(it.blockId) } : {}),
      title: tr(it.title as LocaleText, lang),
      desc: tr(it.desc as LocaleText, lang),
      command: it.command ?? '',
      level: it.level ?? 'required',
      why: tr(it.why as LocaleText, lang),
      section: tr(it.section as LocaleText, lang),
      subtasks: (it.subtasks ?? []).map((s) => tr(s as LocaleText, lang)),
      refs: (it.refs ?? []).map((r) => ({ label: tr(r.label as LocaleText, lang), ...(r.url ? { url: r.url } : {}) })),
      // Пометки канона: ядро всё равно возьмёт их из текущей версии по blockId
      // (иначе клиент, который их не заполнил, снимал бы пометку с необратимой
      // команды), но у ПОКАЗА канона текстом источник один — эта структура.
      ...(it.imageKey ? { imageKey: it.imageKey } : {}),
      ...(it.needsHuman ? { needsHuman: true } : {}),
      ...(it.needsHumanAsk ? { needsHumanAsk: tr(it.needsHumanAsk, lang) } : {}),
      ...(it.danger ? { danger: true } : {}),
    })),
  }
}

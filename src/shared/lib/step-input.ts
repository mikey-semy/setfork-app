import type { GeneratedItem } from '@/shared/ai/generate'
import type { ProposedItem } from '@/shared/db'
import type { Lang } from '@/shared/i18n'
import { isRiskyCommand } from '@/core/domain/destructive-command'

/**
 * Единая конвертация шагов на запись: сгенерированный ИИ пункт → ProposedItem →
 * форма для listStore.create/addVersion.
 *
 * Почему в общем модуле: одни и те же две функции были скопированы в
 * features/gardener/service.ts и features/library/actions.ts, и самогенерация стала
 * бы третьей копией. Копии уже разъезжались — в садовнике `section` однажды терялся
 * именно здесь, и секционные списки целиком выпадали из свипа.
 */

/** Пункт от ИИ (плоские строки) → ProposedItem (LocaleText по языку списка). */
export function toProposed(items: GeneratedItem[], lang: Lang): ProposedItem[] {
  return items.map((it) => ({
    title: { [lang]: it.title.trim() },
    desc: it.desc.trim() ? { [lang]: it.desc.trim() } : {},
    command: (it.command ?? '').trim(),
    hasImage: false,
    level: it.level ?? 'required',
    why: it.why?.trim() ? { [lang]: it.why.trim() } : {},
    // Пометка «здесь нужен человек» переносится ВМЕСТЕ с вопросом: без вопроса это
    // просто «мы не знаем», с вопросом — приглашение ответить из опыта.
    ...(it.needsHuman ? { needsHuman: true, needsHumanAsk: it.needsHumanAsk?.trim() ? { [lang]: it.needsHumanAsk.trim() } : {} } : {}),
    section: it.section?.trim() ? { [lang]: it.section.trim() } : {},
    subtasks: (it.subtasks ?? []).filter((s) => s.trim()).map((s) => ({ [lang]: s.trim() })),
    refs: (it.refs ?? [])
      .filter((r) => r.label?.trim())
      .map((r) => ({ label: { [lang]: r.label.trim() }, ...(r.url?.trim() ? { url: r.url.trim() } : {}) })),
  }))
}

/** ProposedItem[] → шаги для listStore (нумерация, дефолты type/content). */
export function toStepInput(items: ProposedItem[]) {
  return items.map((it, i) => ({
    n: i + 1,
    type: it.type ?? 'step',
    content: it.content ?? {},
    // Идентичность блока сквозь версии: на ней держатся комментарии к пункту и
    // merge по идентичности. Раньше её переносила только копия конвертера в
    // features/library/actions.ts — а та, в свою очередь, теряла пометку
    // «здесь нужен человек». Обе половины должны жить в ОДНОЙ функции.
    blockId: it.blockId ?? null,
    title: it.title,
    desc: it.desc,
    command: it.command,
    level: it.level,
    why: it.why,
    needsHuman: it.needsHuman ?? false,
    needsHumanAsk: it.needsHumanAsk ?? {},
    // РАЗРУШИТЕЛЬНЫЙ ПУНКТ. Тристейт намеренный: пометка не задана — ставим её по
    // шаблону команды, задана (в т.ч. явным false) — уважаем решение автора.
    // Место одно на все пути записи (редактор, генерация, садовник, MCP): будь
    // авто-простановка в каждом из них, ровно один однажды бы её потерял.
    danger: it.danger ?? isRiskyCommand(it.command),
    section: it.section,
    subtasks: it.subtasks,
    refs: it.refs,
    imageRef: it.imageKey ?? null,
  }))
}

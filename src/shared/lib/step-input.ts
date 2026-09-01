import type { GeneratedItem } from '@/shared/ai/generate'
import { cleanText } from './text-input'
import { stripOrdinal } from './ordinal'
import { newBlockId } from './block-id'
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
  // Текст приводится к канонической форме ЗДЕСЬ: это общий вход состава для веба, MCP и
  // генерации, и «ё» в составной форме иначе доезжает до базы как другая строка
  // (см. shared/lib/text-input).
  return items.map((it) => ({
    title: { [lang]: cleanText(it.title) },
    desc: cleanText(it.desc) ? { [lang]: cleanText(it.desc) } : {},
    command: cleanText(it.command),
    hasImage: false,
    level: it.level ?? 'required',
    why: cleanText(it.why) ? { [lang]: cleanText(it.why) } : {},
    // Пометка «здесь нужен человек» переносится ВМЕСТЕ с вопросом: без вопроса это
    // просто «мы не знаем», с вопросом — приглашение ответить из опыта.
    ...(it.needsHuman ? { needsHuman: true, needsHumanAsk: cleanText(it.needsHumanAsk) ? { [lang]: cleanText(it.needsHumanAsk) } : {} } : {}),
    section: cleanText(it.section) ? { [lang]: cleanText(it.section) } : {},
    subtasks: (it.subtasks ?? []).map((s) => cleanText(s)).filter(Boolean).map((s) => ({ [lang]: s })),
    refs: (it.refs ?? [])
      .filter((r) => cleanText(r.label))
      .map((r) => ({ label: { [lang]: cleanText(r.label) }, ...(cleanText(r.url) ? { url: cleanText(r.url) } : {}) })),
  }))
}

/** То же по всем языкам LocaleText: заголовок переведён, номер продублирован в каждом.
 *  Сама узда живёт в shared/lib/ordinal — её вторая половина (`splitOrdinal`) нужна показу,
 *  и держать правило в двух местах значило бы разъехаться в первый же раз. */
const withoutOrdinal = <T extends Record<string, string | undefined> | undefined>(t: T): T =>
  (t ? (Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'string' ? stripOrdinal(v) : v])) as T) : t)

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
    // ИДЕНТИЧНОСТЬ ВЫДАЁТСЯ ЗДЕСЬ, если её нет. Без неё блок не переживает запись как «тот
    // же»: на block_id держатся комментарии к пункту, merge по идентичности и ПЕРЕНОС
    // надстроек при пуше (CarryOver в ядре ключуется по нему). Линза ядра 02 измерила цену
    // пропуска: шаг без идентичности теряет при пуше все четыре надстройки разом —
    // «здесь нужен человек», вопрос к человеку, «разрушительный пункт» и картинку. На проде
    // 20.08 таких шагов 610 из 5116 в 86 списках, и 85 из них несут пометку или картинку.
    //
    // Место одно на все пути записи — как и остальное в этом модуле. Редактор выдавал id
    // сам (toProposedItems), а пути генерации (садовник, самогенерация, гном) — нет, и
    // писали строки без идентичности. Выдавать её В `toProposed` было НЕЛЬЗЯ: садовник
    // сравнивает `JSON.stringify(toProposed(...))` как отпечаток «изменилось ли», и
    // случайный uuid внутри ломал бы правило остановки «два прохода без изменений».
    blockId: it.blockId ?? newBlockId(),
    // Транспортное поле: см. ProposedItem.langScope. Снимает его фасад listStore.
    langScope: it.langScope,
    title: withoutOrdinal(it.title),
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
    section: withoutOrdinal(it.section),
    subtasks: it.subtasks,
    refs: it.refs,
    imageRef: it.imageKey ?? null,
  }))
}

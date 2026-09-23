import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { db, digGuides } from '@/shared/db'
import { decide } from '@/shared/ai/decide'
import { fitsQuestion, guideAbout, guideQuestion, guideState, type GuideCandidate } from '@/shared/ai/guide-question'
import type { Expert } from '@/shared/ai/roster'

/**
 * КТО ПОВЕДЁТ ПО ЭТОМУ ПУНКТУ — решает Jev, а не совпадение тегов СПИСКА.
 *
 * Прежнее правило (`pickExpert`) смотрело на теги списка, поэтому у всех пунктов одного
 * списка проводник был один: `pg_stat_statements` в списке «медленное API» вёл DevOps, а
 * разборы Commitics почти целиком уходили универсалу. На наборе из 57 пунктов оно
 * попадает в допустимого мастера в 28 случаях, Jev — в 57 (замер
 * `scripts/gnome-routing-eval.ts`, PR #961; решение владельца встроить — 23.09.2026).
 *
 * Правила встраивания:
 *  • `null` — не проводник, а сигнал взять запасное правило: сбой модели, исчерпанный
 *    бюджет, неразобранный ответ. Вызывающий обязан его иметь (`pickExpert`);
 *  • порога уверенности НЕТ: набор замера упёрся в потолок (ни одного промаха), и
 *    откалибровать порог было не на чем. Решения и уверенность копятся в `dig_guides`,
 *    порог подберут по ним;
 *  • один вопрос на пункт версии — ответ кэшируется в `dig_guides`;
 *  • вопрос «подходит ли пункт ремеслу выбранного» задаётся в ТЕНИ (`fits`): пишется, ни
 *    на что не влияет.
 */

const candidateOf = (e: Expert): GuideCandidate => ({ id: e.id, about: guideAbout(e.persona), domains: e.domains })

export interface GuideItem {
  templateId: string
  version: number
  stepN: number
  listTitle: string
  tags: string[]
  section?: string | null
  /** Текст пункта на языке читателя: заголовок, пояснение, markdown текст-блока. */
  item: string
  userId: string
}

export interface ItemGuide {
  expert: Expert
  /**
   * Теневой вопрос о ремесле. Вызывающий дожидается его, пока гном отвечает, — задержки
   * это не добавляет, а незавершённая запись не теряется вместе с запросом.
   */
  shadow: Promise<void>
}

const done: Promise<void> = Promise.resolve()

export async function guideForItem(it: GuideItem, roster: Expert[]): Promise<ItemGuide | null> {
  const where = and(eq(digGuides.templateId, it.templateId), eq(digGuides.version, it.version), eq(digGuides.stepN, it.stepN))
  const [cached] = await db.select({ gnomeId: digGuides.gnomeId }).from(digGuides).where(where).limit(1)
  const hit = cached && roster.find((e) => e.id === cached.gnomeId)
  // Выбранный гном мог быть выключен в админке с тех пор — тогда спрашиваем заново.
  if (hit) return { expert: hit, shadow: done }

  const question = guideQuestion(roster.map(candidateOf))
  // Выбирать не из кого — спрашивать модель незачем.
  if (Object.keys(question.criteria).length < 2) return null

  const state = guideState({ listTitle: it.listTitle, tags: it.tags, section: it.section, item: it.item })
  const ref = { refType: 'template', refId: it.templateId, userId: it.userId }
  const r = await decide({ state, questions: { guide: question }, ...ref })
  const a = r?.answers.guide
  if (!r || a?.type !== 'choice') return null
  const expert = roster.find((e) => e.id === a.choice)
  if (!expert) return null

  // ⚠️ ГОНКА ДВУХ ПЕРВЫХ ВОПРОСОВ. Оба прошли мимо пустого кэша и спросили модель сами;
  // перезапиши второй первого — пропал бы `fits` победителя, а теневой ответ одного мастера
  // лёг бы к другому, и выборка калибровки испортилась бы молча (авто-ревью к #964).
  // Поэтому строка пишется только если её ещё нет, а замена выключенного — только если в
  // строке всё ещё прежний; проигравший берёт победителя и тень не задаёт.
  const row = { gnomeId: expert.id, confidence: a.confidence, probabilities: a.probabilities, model: r.model, fits: null }
  const written = cached
    ? await db
        .update(digGuides)
        .set(row)
        .where(and(where, eq(digGuides.gnomeId, cached.gnomeId)))
        .returning({ gnomeId: digGuides.gnomeId })
    : await db
        .insert(digGuides)
        .values({ templateId: it.templateId, version: it.version, stepN: it.stepN, ...row })
        .onConflictDoNothing()
        .returning({ gnomeId: digGuides.gnomeId })
  if (!written.length) {
    const [winner] = await db.select({ gnomeId: digGuides.gnomeId }).from(digGuides).where(where).limit(1)
    const won = winner && roster.find((e) => e.id === winner.gnomeId)
    return won ? { expert: won, shadow: done } : null
  }

  const shadow = (async () => {
    const f = await decide({ state, questions: { fits: fitsQuestion(candidateOf(expert)) }, ...ref })
    const n = f?.answers.fits
    // Только своему мастеру и только в пустое поле: строку могли перевыбрать, пока шёл вопрос.
    if (n?.type === 'noul') {
      await db
        .update(digGuides)
        .set({ fits: n.noul })
        .where(and(where, eq(digGuides.gnomeId, expert.id), isNull(digGuides.fits)))
    }
  })().catch((e) => console.warn('[dig-guide] теневой вопрос о ремесле не записан', e instanceof Error ? e.message : e))

  return { expert, shadow }
}

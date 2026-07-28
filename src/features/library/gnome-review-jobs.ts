import 'server-only'
import { isLang, type Lang } from '@/shared/i18n'
import { runGnomeSuggestionReview } from './gnome-review'

/**
 * Ревью предложения гномом — фоном, а не в экшене запроса ревью.
 *
 * Вызов модели идёт секунды и может отвалиться: держать на нём серверный экшен
 * значило бы, что человек ждёт спиннер, а при таймауте теряет и просьбу о ревью.
 * Через очередь просьба остаётся зафиксированной, а вердикт приходит, когда
 * гном закончил — ровно так же, как ждут живого рецензента.
 */
export async function runGnomeReviewJob(raw: unknown): Promise<void> {
  const payload = (raw ?? {}) as Record<string, unknown>
  const suggestionId = String(payload.suggestionId ?? '')
  const expertId = String(payload.expertId ?? '')
  const langRaw = String(payload.lang ?? 'en')
  const lang: Lang = isLang(langRaw) ? langRaw : 'en'
  if (!suggestionId || !expertId) return

  const res = await runGnomeSuggestionReview(suggestionId, expertId, lang)
  // Не состоялось по СМЫСЛУ (правку закрыли, ИИ выключен, смотреть нечего) —
  // это не сбой джобы: ретраить нечего, повтор дал бы тот же ответ.
  if (!res.ok) return
}

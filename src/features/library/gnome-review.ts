import 'server-only'
import { and, eq } from 'drizzle-orm'
import { generateText } from 'ai'
import { councilExperts, db, suggestionReviews, suggestions, users } from '@/shared/db'
import { getRoster } from '@/shared/ai/roster'
import { buildPrReviewPrompt } from '@/shared/ai/gnome'
import { getAiSettings } from '@/shared/settings/ai'
import { getAiChatClient } from '@/shared/ai/provider'
import { pickChatModel } from '@/shared/ai/credits'
import { extractUsage, recordUsage } from '@/shared/ai/usage'
import { globalBudgetOk } from '@/shared/quota'
import { tr, type Lang } from '@/shared/i18n'
// eslint-disable-next-line boundaries/dependencies -- уведомление автора о вердикте
import { notify } from '@/features/notifications/notify'
import { suggestionBlocks } from './suggestion-blocks'

const CALL_TIMEOUT_MS = 60_000

/**
 * РЕВЬЮ ПРЕДЛОЖЕНИЯ ГНОМОМ — «запросили ревью» перестаёт быть просьбой в пустоту.
 *
 * Гномы у нас уже настоящие пользователи (`ensureGnomeUser`), поэтому вердикт
 * пишется в ту же таблицу, что и человеческий: гейты слияния, счётчик одобрений
 * и панель ревью работают с ним без единой ветки «а если это гном». Ровно ради
 * этого он и хранится одинаково.
 *
 * Возвращает id вердикта либо причину, по которой ревью не состоялось.
 */
export async function runGnomeSuggestionReview(
  suggestionId: string,
  expertId: string,
  lang: Lang,
): Promise<{ ok: true; verdict: string } | { ok: false; reason: string }> {
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug || sug.status !== 'open') return { ok: false, reason: 'suggestion is not open' }

  const [expert] = (await getRoster()).filter((e) => e.id === expertId)
  if (!expert) return { ok: false, reason: `unknown gnome ${expertId}` }
  const [row] = await db.select({ userId: councilExperts.userId }).from(councilExperts).where(eq(councilExperts.id, expertId)).limit(1)
  if (!row?.userId) return { ok: false, reason: 'gnome has no account' }

  const client = await getAiChatClient()
  const settings = await getAiSettings()
  if (!client || !settings.enabled) return { ok: false, reason: 'AI is disabled' }
  if (!(await globalBudgetOk())) return { ok: false, reason: 'AI budget exhausted' }

  // Предлагаемые пункты — по общему правилу (у ветки они в git, у старых в БД).
  // Именно ЗАГРУЖАЮЩИЙ вариант: без снапшота у ветки пунктов не будет вовсе, и
  // гном получил бы пустое предложение (та же ловушка, что с комментариями).
  const owner = await ownerHandleOf(sug.template.ownerId)
  const items = await suggestionBlocks(sug, owner, sug.template.slug)
  const change = {
    title: sug.note,
    baseVersion: sug.baseVersion,
    branch: sug.branchRef ?? undefined,
    items: items.slice(0, 60).map((it, i) => ({
      n: i + 1,
      title: tr(it.title as never, lang),
      desc: tr(it.desc as never, lang),
      why: tr(it.why as never, lang),
    })),
  }
  // Пусто — смотреть нечего, вызов модели не тратим.
  if (change.items.length === 0) return { ok: false, reason: 'nothing to review' }

  const forProvider = (m: string) =>
    client.cfg.provider === 'yandex' ? m.startsWith('gpt://') : client.cfg.provider === 'gigachat' ? !m.includes('/') : true
  const model = expert.model && forProvider(expert.model) ? expert.model : await pickChatModel(settings)
  const { system, prompt } = buildPrReviewPrompt(expert, JSON.stringify(change).slice(0, 6000))

  const startedAt = Date.now()
  let text: string
  try {
    const result = await generateText({
      model: client.chat(model),
      system,
      prompt,
      temperature: settings.temperature,
      maxOutputTokens: 900,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    text = result.text
    const usage = extractUsage(result)
    await recordUsage({
      userId: row.userId,
      feature: 'mcp-gnome',
      model,
      input: usage.input,
      output: usage.output,
      total: usage.total,
      cost: usage.cost,
      refType: 'suggestion',
      refId: sug.id,
      outcome: 'ok',
      durationMs: Date.now() - startedAt,
      provider: client.cfg.provider,
    })
  } catch {
    return { ok: false, reason: 'the gnome could not finish the review' }
  }

  const parsed = parseVerdict(text)
  // Вердикт ОДИН на рецензента — перезаписываем свой прежний, как у людей.
  await db.delete(suggestionReviews).where(and(eq(suggestionReviews.suggestionId, sug.id), eq(suggestionReviews.reviewerId, row.userId)))
  await db.insert(suggestionReviews).values({ suggestionId: sug.id, reviewerId: row.userId, verdict: parsed.verdict, body: parsed.body })
  if (sug.authorId !== row.userId) {
    await notify({
      recipientId: sug.authorId,
      actorId: row.userId,
      type: 'review_requested',
      templateId: sug.templateId,
      suggestionId: sug.id,
    })
  }
  return { ok: true, verdict: parsed.verdict }
}

/**
 * Разбор ответа модели в вердикт + текст.
 *
 * JSON может не собраться — тогда НЕ выдумываем «approve»: непонятый ответ
 * становится «comment», то есть не блокирует и не одобряет. Ошибиться в сторону
 * молчаливого одобрения здесь опаснее всего: это голос в гейте слияния.
 */
function parseVerdict(raw: string): { verdict: 'approve' | 'changes' | 'comment'; body: string } {
  const s = raw.indexOf('{')
  const e = raw.lastIndexOf('}')
  let obj: Record<string, unknown> | null = null
  try {
    obj = s >= 0 && e > s ? (JSON.parse(raw.slice(s, e + 1)) as Record<string, unknown>) : null
  } catch {
    obj = null
  }
  if (!obj) return { verdict: 'comment', body: raw.trim().slice(0, 4000) }

  const v = String(obj.verdict ?? '').toLowerCase()
  const verdict = v === 'approve' ? 'approve' : v === 'changes' ? 'changes' : 'comment'
  const issues = Array.isArray(obj.issues) ? (obj.issues as Record<string, unknown>[]) : []
  const lines = [String(obj.summary ?? '').trim()]
  for (const it of issues.slice(0, 5)) {
    const where = String(it.where ?? '').trim()
    const problem = String(it.problem ?? '').trim()
    const fix = String(it.fix ?? '').trim()
    if (!problem) continue
    lines.push(`- **${where || '—'}** — ${problem}${fix ? `\n  - ${fix}` : ''}`)
  }
  // «Нужны правки» без единой претензии заблокировало бы правку без объяснения —
  // такой вердикт понижаем до замечания.
  if (verdict === 'changes' && issues.length === 0) return { verdict: 'comment', body: lines.join('\n').trim().slice(0, 4000) }
  return { verdict, body: lines.join('\n').trim().slice(0, 4000) }
}

async function ownerHandleOf(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  return u?.handle ?? ''
}

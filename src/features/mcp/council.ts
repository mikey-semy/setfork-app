import 'server-only'
import { db, generations } from '@/shared/db'
import { detectTextLang } from '@/shared/i18n/detect-text-lang'
import { classifyListKind } from '@/shared/ai/list-kind'
import { getMessages, pushMessage, setGenerationStatus } from '@/shared/ai/generation-messages'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { aiQuota, freeGenQuota } from '@/shared/quota'
import { getAiSettings, isAiAvailable } from '@/shared/settings/ai'
import { enqueueJob } from '@/shared/jobs/queue'
import { eq } from 'drizzle-orm'
import { getGeneration } from '@/features/generation/queries'
import { db as _db, users } from '@/shared/db'

/**
 * Совет гномов через MCP (HQ §1, этап 2): council_draft ставит генерацию в ТУ ЖЕ
 * трубу, что чат сайта (строка generations + джоба воркера) — MCP-клиент не висит
 * на 4-минутном совете, а забирает результат вторым инструментом get_council_draft.
 * Бонус: беседа сохраняется в истории и открывается на сайте по ссылке.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'https://setfork.com').replace(/\/$/, '')

export async function mcpCouncilDraft(userId: string, rawQuery: string): Promise<{ draftId: string; status: string; url: string; note: string } | { error: string }> {
  const query = (rawQuery ?? '').trim().slice(0, 300)
  if (!query) return { error: 'Empty query' }
  if (!(await isAiAvailable())) return { error: 'AI is disabled on this instance' }

  const { allowed } = await checkRateLimit(`gen:${userId}`)
  if (!allowed) return { error: 'Too many generations — wait a bit' }
  const [u] = await _db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  if (!(await aiQuota(userId, u?.handle)).ok) return { error: 'Your monthly AI quota is used up' }
  const { freeMonthlyGens } = await getAiSettings()
  if (!(await freeGenQuota(userId, u?.handle, freeMonthlyGens)).ok) return { error: 'Free monthly generation limit reached' }

  // Язык списка — из самого запроса (как на сайте); тип — грамматический дефолт,
  // дальше его можно сменить на сайте переключателем.
  const lang = detectTextLang(query, 'en')
  const listKind = classifyListKind(query)
  const [gen] = await db.insert(generations).values({ userId, query, lang, status: 'pending', listKind }).returning()
  await pushMessage(gen.id, { attempt: 1, kind: 'user', text: query })
  await setGenerationStatus(gen.id, 'pending')
  await enqueueJob('generate', { generationId: gen.id, userId, query, lang, idx: 1 }, { maxAttempts: 2 })

  return {
    draftId: gen.id,
    status: 'pending',
    url: `${SITE_URL}/generate/${gen.id}`,
    note: 'The council is convening (typically 1-4 minutes). Poll get_council_draft with this draftId; the chat is also live at the url.',
  }
}

export async function mcpGetCouncilDraft(userId: string, draftId: string): Promise<Record<string, unknown> | { error: string }> {
  const gen = await getGeneration(draftId, userId)
  if (!gen) return { error: 'Draft not found (or not yours)' }
  const messages = await getMessages(draftId)
  return {
    draftId,
    status: gen.status,
    url: `${SITE_URL}/generate/${draftId}`,
    // Ход совета — «характер» мастерской виден и по MCP: кто говорил и что.
    council: messages.map((m) => ({ attempt: m.attempt, kind: m.kind, who: m.who ?? undefined, name: m.name ?? undefined, text: m.text })),
    candidates: gen.candidates.map((c) => ({ idx: c.idx, title: c.title, desc: c.desc, summary: c.summary || undefined, tags: c.tags, items: c.items })),
    accepted: Boolean(gen.chosenTemplateId),
  }
}

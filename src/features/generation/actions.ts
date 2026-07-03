'use server'

import { eq, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db, generationCandidates, generations, users, type CandidateItem } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import type { Lang } from '@/shared/i18n'
import { generateListDraft, sanitizeCommand } from '@/shared/ai/generate'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { toProposedItems } from '@/features/library/editor'
import { listStore } from '@/features/library/list-store.adapter'
import { parseTags, uniqueSlug } from '@/features/library/slug'

async function ownerHandle(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return u.handle
}

/** Сгенерировать один вариант и сохранить его кандидатом (idx). Возвращает false при ошибке ИИ. */
async function addCandidate(
  generationId: string,
  userId: string,
  query: string,
  lang: 'en' | 'ru',
  idx: number,
): Promise<boolean> {
  const draft = await generateListDraft(query, lang, {
    web: true,
    variant: idx,
    userId,
    feature: idx > 1 ? 'regenerate' : 'generate',
    refType: 'generation',
    refId: generationId,
  })
  if (!draft) return false
  const items: CandidateItem[] = draft.items.map((it) => ({
    title: it.title,
    desc: it.desc,
    command: it.command,
    level: it.level,
    why: it.why,
    subtasks: it.subtasks,
  }))
  await db.insert(generationCandidates).values({
    generationId,
    idx,
    title: (draft.title || query).slice(0, 140),
    desc: draft.desc ?? '',
    tags: draft.tags.length ? parseTags(draft.tags.join(' ')) : parseTags(query),
    items,
  })
  return true
}

// ── Старт генерации: запрос → первый кандидат → экран выбора ──────────
export async function startGeneration(formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const query = String(formData.get('q') ?? '').trim().slice(0, 300)
  if (!query) redirect('/explore')

  const { allowed } = checkRateLimit(`gen:${session.userId}`)
  if (!allowed) redirect(`/explore?q=${encodeURIComponent(query)}&e=ratelimited`)

  const [gen] = await db.insert(generations).values({ userId: session.userId, query, lang }).returning()
  const ok = await addCandidate(gen.id, session.userId, query, lang, 1)
  if (!ok) {
    await db.delete(generations).where(eq(generations.id, gen.id))
    redirect(`/explore?q=${encodeURIComponent(query)}&e=aifail`)
  }
  redirect(`/generate/${gen.id}`)
}

// ── Перегенерировать: добавить ещё один вариант-кандидат ──────────────
export async function regenerateCandidate(generationId: string): Promise<void> {
  const session = await requireSession()
  const gen = await db.query.generations.findFirst({ where: (g) => eq(g.id, generationId) })
  if (!gen || gen.userId !== session.userId || gen.chosenTemplateId) redirect('/explore')

  const { allowed } = checkRateLimit(`gen:${session.userId}`)
  if (!allowed) redirect(`/generate/${generationId}?e=ratelimited`)

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${generationCandidates.idx}), 0)::int` })
    .from(generationCandidates)
    .where(eq(generationCandidates.generationId, generationId))
  const nextIdx = (max ?? 0) + 1
  if (nextIdx > 6) redirect(`/generate/${generationId}?v=${max}`) // разумный потолок вариантов

  const ok = await addCandidate(generationId, session.userId, gen.query, gen.lang as 'en' | 'ru', nextIdx)
  if (!ok) redirect(`/generate/${generationId}?e=aifail`)
  revalidatePath(`/generate/${generationId}`)
  redirect(`/generate/${generationId}?v=${nextIdx}`)
}

// ── Принять кандидата → создать черновик-список (draft) ───────────────
export async function acceptCandidate(generationId: string, candidateId: string): Promise<void> {
  const session = await requireSession()
  const gen = await db.query.generations.findFirst({ where: (g) => eq(g.id, generationId) })
  if (!gen || gen.userId !== session.userId) redirect('/explore')
  if (gen.chosenTemplateId) {
    // уже принят — открываем созданный список
    const t = await db.query.templates.findFirst({ where: (tt) => eq(tt.id, gen.chosenTemplateId!) })
    if (t) redirect(`/${await ownerHandle(t.ownerId)}/${t.slug}`)
    redirect('/explore')
  }

  const cand = await db.query.generationCandidates.findFirst({
    where: (c) => eq(c.id, candidateId),
  })
  if (!cand || cand.generationId !== generationId) redirect(`/generate/${generationId}`)

  // Ключ locale-JSON = язык, на котором СГЕНЕРИРОВАН контент (а не текущий UI-язык).
  const genLang: Lang = gen.lang === 'ru' ? 'ru' : 'en'
  const slug = await uniqueSlug(cand.title || gen.query, session.userId)
  const proposed = toProposedItems(
    cand.items.map((it) => ({
      title: it.title,
      desc: it.desc,
      command: sanitizeCommand(it.command ?? ''),
      imageKey: '',
      imagePreview: '',
      level: it.level ?? 'required',
      why: it.why ?? '',
      section: '',
      subtasks: it.subtasks,
      refs: [],
    })),
    genLang,
  )

  const list = await listStore.create({
    ownerId: session.userId,
    slug,
    title: { [genLang]: cand.title || gen.query },
    desc: cand.desc ? { [genLang]: cand.desc } : {},
    tags: cand.tags,
    ordered: true,
    visibility: 'public',
    status: 'draft', // черновик: не публичен, пока владелец не опубликует
    origin: 'ai_draft',
    note: 'ai draft',
    steps: proposed.map((it, i) => ({
      n: i + 1,
      title: it.title,
      desc: it.desc,
      command: it.command,
      level: it.level,
      why: it.why,
      section: it.section,
      subtasks: it.subtasks,
      refs: it.refs,
      imageRef: it.imageKey ?? null,
    })),
  })
  await db.update(generations).set({ chosenTemplateId: list.id }).where(eq(generations.id, gen.id))

  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}

'use server'

import { eq, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db, generationCandidates, generations, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { DEFAULT_LANG, isLang, type Lang } from '@/shared/i18n'
import { sanitizeCommand } from '@/shared/ai/generate'
import { getClarify, clearClarify } from '@/shared/ai/council-clarify'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { aiQuota, listQuota } from '@/shared/quota'
import { enqueueJob } from '@/shared/jobs/queue'
import { enqueueReindex } from '@/features/library/jobs'
import { toProposedItems } from '@/features/library/editor'
import { listStore } from '@/features/library/list-store'
import { uniqueSlug } from '@/features/library/slug'

async function ownerHandle(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return u.handle
}

// Ставит задачу генерации варианта в очередь (сама генерация — в фоновом воркере,
// см. features/generation/service.ts + shared/jobs). Страница дождётся кандидата поллингом.
async function enqueueGenerate(generationId: string, userId: string, query: string, lang: string, idx: number): Promise<void> {
  // maxAttempts:2 (одна повторная попытка) — генерация тратит токены на каждой,
  // а квота проверяется при постановке, не на ретрае. Дефолтные 5 попыток на
  // стабильно-неудачном ответе модели множили бы расход ×5.
  await enqueueJob('generate', { generationId, userId, query, lang: isLang(lang) ? lang : DEFAULT_LANG, idx }, { maxAttempts: 2 })
}

// ── Старт генерации: запрос → задача в очередь → экран ожидания ───────
export async function startGeneration(formData: FormData): Promise<void> {
  const session = await requireSession()
  const lang = await getLang()
  const query = String(formData.get('q') ?? '').trim().slice(0, 300)
  if (!query) redirect('/search')

  const { allowed } = await checkRateLimit(`gen:${session.userId}`)
  if (!allowed) redirect(`/search?q=${encodeURIComponent(query)}&e=ratelimited`)
  if (!(await aiQuota(session.userId, session.handle)).ok) redirect(`/generate?e=ai_quota&q=${encodeURIComponent(query)}`)

  const [gen] = await db.insert(generations).values({ userId: session.userId, query, lang }).returning()
  await enqueueGenerate(gen.id, session.userId, query, lang, 1)
  redirect(`/generate/${gen.id}`)
}

// ── Перегенерировать: добавить ещё один вариант-кандидат ──────────────
export async function regenerateCandidate(generationId: string): Promise<void> {
  const session = await requireSession()
  const gen = await db.query.generations.findFirst({ where: (g) => eq(g.id, generationId) })
  if (!gen || gen.userId !== session.userId || gen.chosenTemplateId) redirect('/explore')

  const { allowed } = await checkRateLimit(`gen:${session.userId}`)
  if (!allowed) redirect(`/generate/${generationId}?e=ratelimited`)
  if (!(await aiQuota(session.userId, session.handle)).ok) redirect(`/generate/${generationId}?e=ai_quota`)

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${generationCandidates.idx}), 0)::int` })
    .from(generationCandidates)
    .where(eq(generationCandidates.generationId, generationId))
  const nextIdx = (max ?? 0) + 1
  // Потолок вариантов: не молча, а с флагом — UI покажет причину.
  if (nextIdx > 6) redirect(`/generate/${generationId}?v=${max}&e=variantcap`)

  await enqueueGenerate(generationId, session.userId, gen.query, gen.lang, nextIdx)
  redirect(`/generate/${generationId}?v=${nextIdx}`)
}

// ── Правка запроса → новый вариант, СТАРЫЕ сохраняются ────────────────
export async function regenerateWithQuery(generationId: string, newQuery: string): Promise<void> {
  const session = await requireSession()
  const gen = await db.query.generations.findFirst({ where: (g) => eq(g.id, generationId) })
  if (!gen || gen.userId !== session.userId || gen.chosenTemplateId) redirect('/explore')

  const query = newQuery.trim().slice(0, 300)
  if (!query) redirect(`/generate/${generationId}`)

  const { allowed } = await checkRateLimit(`gen:${session.userId}`)
  if (!allowed) redirect(`/generate/${generationId}?e=ratelimited`)
  if (!(await aiQuota(session.userId, session.handle)).ok) redirect(`/generate/${generationId}?e=ai_quota`)

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${generationCandidates.idx}), 0)::int` })
    .from(generationCandidates)
    .where(eq(generationCandidates.generationId, generationId))
  const nextIdx = (max ?? 0) + 1
  if (nextIdx > 6) redirect(`/generate/${generationId}?v=${max}&e=variantcap`)

  // Обновляем запрос генерации: заголовок и будущие «ещё вариант» пойдут по нему.
  // Прежние кандидаты НЕ трогаем — пользователь сам решит, какой оставить.
  if (query !== gen.query) await db.update(generations).set({ query }).where(eq(generations.id, generationId))

  await enqueueGenerate(generationId, session.userId, query, gen.lang, nextIdx)
  redirect(`/generate/${generationId}?v=${nextIdx}`)
}

// ── Ответить на уточняющие вопросы совета → перезапустить генерацию с контекстом ──────
export async function answerClarify(generationId: string, answers: string[]): Promise<void> {
  const session = await requireSession()
  const gen = await db.query.generations.findFirst({ where: (g) => eq(g.id, generationId) })
  if (!gen || gen.userId !== session.userId || gen.chosenTemplateId) redirect('/explore')

  const questions = getClarify(generationId)
  if (!questions.length) redirect(`/generate/${generationId}`) // нечего уточнять (протухло/уже ответили)
  // #2: клеймим АТОМАРНО — до первого await. Параллельный double-submit (Enter+клик / две вкладки)
  // увидит пусто и не задвоит джобу idx=1 (иначе UNIQUE(generationId,idx) → упавшая джоба).
  clearClarify(generationId)

  const { allowed } = await checkRateLimit(`gen:${session.userId}`)
  if (!allowed) redirect(`/generate/${generationId}?e=ratelimited`)
  if (!(await aiQuota(session.userId, session.handle)).ok) redirect(`/generate/${generationId}?e=ai_quota`)

  // Память нити: пары «вопрос→ответ» подмешиваем в ЗАПРОС ДЖОБЫ (generations.query не портим —
  // заголовок остаётся чистым). Совет с контекстом уже не спросит уточнений и сгенерирует список.
  const qa = questions.map((q, i) => `Q: ${q}\nA: ${(answers[i] ?? '').trim() || '(no answer)'}`).join('\n')
  const augmented = `${gen.query}\n\n[User clarifications]\n${qa}`.slice(0, 2000)
  await enqueueGenerate(generationId, session.userId, augmented, gen.lang, 1)
  redirect(`/generate/${generationId}`)
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
  // Принятие кандидата создаёт список — та же квота, что у обычного создания.
  if (!(await listQuota(session.userId, session.handle)).ok) redirect(`/generate/${generationId}?e=list_quota`)

  // Ключ locale-JSON = язык, на котором СГЕНЕРИРОВАН контент (а не текущий UI-язык).
  const genLang: Lang = isLang(gen.lang) ? gen.lang : DEFAULT_LANG
  const slug = await uniqueSlug(cand.title || gen.query, session.userId)
  const proposed = toProposedItems(
    cand.items.map((it) => ({
      type: 'step' as const,
      bid: '',
      text: '',
      caption: '',
      videoUrl: '',
      fileUrl: '',
      fileName: '',
      poll: { question: '', options: [], multi: false, deadline: '' },
      quiz: { kind: 'choice' as const, question: '', options: [], multi: false, accept: [], caseSensitive: false, answer: '', tolerance: '', template: '', blanks: [], pairs: [], items: [], explain: '' },
      products: [],
      title: it.title,
      desc: it.desc,
      command: sanitizeCommand(it.command ?? ''),
      imageKey: '',
      imagePreview: '',
      level: it.level ?? 'required',
      why: it.why ?? '',
      section: '',
      subtasks: it.subtasks,
      refs: (it.refs ?? []).map((r) => ({ label: r.label, url: r.url })),
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
  await enqueueReindex(list.id) // авто-индексация в поиск (через очередь)

  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}

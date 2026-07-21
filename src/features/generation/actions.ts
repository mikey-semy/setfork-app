'use server'

import { eq, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db, generationCandidates, generationMessages, generations, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { DEFAULT_LANG, isLang, type Lang } from '@/shared/i18n'
import { detectTextLang } from '@/shared/i18n/detect-text-lang'
import { sanitizeCommand } from '@/shared/ai/generate'
import { classifyListKind, LIST_KINDS } from '@/shared/ai/list-kind'
import { DETAIL_LEVELS, toDetail } from '@/shared/ai/detail-level'
import { claimClarify } from '@/shared/ai/council-clarify'
import { getMessages, pushMessage, setGenerationStatus } from '@/shared/ai/generation-messages'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { aiQuota, freeGenQuota, listQuota } from '@/shared/quota'
import { getAiSettings } from '@/shared/settings/ai'
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
  // Статус ставим ЗДЕСЬ, а не ждём воркера: он опрашивает очередь раз в 3с, и до его подхвата
  // страница рисовалась со старым 'done' — а чат следит за беседой только пока 'pending'. Отсюда
  // была «тишина» после дополнения: задача шла, но экран об этом не знал и ничего не поллил.
  await setGenerationStatus(generationId, 'pending')
  // maxAttempts:2 (одна повторная попытка) — генерация тратит токены на каждой,
  // а квота проверяется при постановке, не на ретрае. Дефолтные 5 попыток на
  // стабильно-неудачном ответе модели множили бы расход ×5.
  await enqueueJob('generate', { generationId, userId, query, lang: isLang(lang) ? lang : DEFAULT_LANG, idx }, { maxAttempts: 2 })
}

/**
 * Номер последнего витка — по кандидатам И по репликам.
 *
 * Только по кандидатам считать нельзя: задача в полёте кандидата ещё не создала, поэтому два
 * «дополнить» подряд получали один и тот же номер, лезли в один слот (UNIQUE(generationId, idx) —
 * часть джоб падала), а их реплики сваливались в один виток: в ленте было «Ход совета: 26» с тремя
 * одинаковыми прогонами. Реплики пишутся действием сразу, поэтому виток в полёте по ним виден.
 */
async function maxIdx(generationId: string): Promise<number> {
  const [{ max }] = await db
    .select({
      max: sql<number>`greatest(
        coalesce((select max(idx) from ${generationCandidates} where generation_id = ${generationId}), 0),
        coalesce((select max(attempt) from ${generationMessages} where generation_id = ${generationId}), 0)
      )::int`,
    })
    .from(generations)
    .where(eq(generations.id, generationId))
  return max ?? 0
}

/**
 * Память нити: исходный запрос + ВСЕ реплики пользователя (дополнения). Уходит в ЗАПРОС ДЖОБЫ,
 * generations.query не портим — заголовок остаётся чистым (тот же приём, что в answerClarify).
 * Благодаря этому «дополнить» именно дополняет, а не подменяет запрос.
 */
async function threadQuery(generationId: string, baseQuery: string): Promise<string> {
  const msgs = await getMessages(generationId)
  const notes = msgs.filter((m) => m.kind === 'user' && m.text.trim()).map((m) => m.text.trim())
  // Первая реплика — сам запрос, она уже в baseQuery.
  const extra = notes.slice(1)
  if (!extra.length) return baseQuery
  return `${baseQuery}\n\n[User refinements, newest last]\n${extra.map((t) => `- ${t}`).join('\n')}`.slice(0, 2000)
}

// ── Старт генерации: запрос → задача в очередь → экран ожидания ───────
export async function startGeneration(formData: FormData): Promise<void> {
  const session = await requireSession()
  const uiLang = await getLang()
  const query = String(formData.get('q') ?? '').trim().slice(0, 300)
  if (!query) redirect('/search')

  // Язык СПИСКА ≠ язык интерфейса: он определяется САМИМ запросом. Написал по-русски —
  // список русский, даже если рядом стоят английские термины; написал по-английски —
  // английский. Переключателя нет намеренно: язык и так явно указан тем, как задан запрос.
  const lang: Lang = detectTextLang(query, uiLang)

  const { allowed } = await checkRateLimit(`gen:${session.userId}`)
  if (!allowed) redirect(`/search?q=${encodeURIComponent(query)}&e=ratelimited`)
  if (!(await aiQuota(session.userId, session.handle)).ok) redirect(`/generate?e=ai_quota&q=${encodeURIComponent(query)}`)
  // Тариф Free: месячный лимит генераций (0 = монетизация не активирована → без лимита). Pro/админ — без лимита.
  const { freeMonthlyGens } = await getAiSettings()
  if (!(await freeGenQuota(session.userId, session.handle, freeMonthlyGens)).ok) redirect(`/generate?e=free_limit&q=${encodeURIComponent(query)}`)

  // Тип списка (ADR-0010): явный выбор на старт-форме сильнее всего — без него первая
  // генерация шла грамматическим дефолтом, промахивалась, и правильный тип стоил ВТОРОЙ
  // генерации (фидбек владельца). «Авто» (пусто) → грамматический классификатор, как раньше.
  const pickedKind = String(formData.get('kind') ?? '')
  const listKind = (LIST_KINDS as string[]).includes(pickedKind) ? pickedKind : classifyListKind(query)
  // Объём — из формы (переключатель на старте); дальше живёт в колонке и переживает «ещё вариант».
  const detail = toDetail(String(formData.get('detail') ?? ''))
  const [gen] = await db.insert(generations).values({ userId: session.userId, query, lang, status: 'pending', listKind, detail }).returning()
  // Запрос — первая реплика беседы: чат начинается с того, что сказал пользователь.
  await pushMessage(gen.id, { attempt: 1, kind: 'user', text: query })
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

  const max = await maxIdx(generationId)
  const nextIdx = max + 1
  // Потолок вариантов: не молча, а с флагом — UI покажет причину.
  if (nextIdx > 6) redirect(`/generate/${generationId}?v=${max}&e=variantcap`)

  // Текста у «ещё варианта» нет — намерение, а не фраза. Подпись рисует UI, поэтому она
  // локализуется на клиенте и не протухает в БД при смене языка.
  await pushMessage(generationId, { attempt: nextIdx, kind: 'again', text: '' })
  await enqueueGenerate(generationId, session.userId, await threadQuery(generationId, gen.query), gen.lang, nextIdx)
  redirect(`/generate/${generationId}?v=${nextIdx}`)
}

// ── Сменить тип списка → новый вариант в этой же форме ───────────────
export async function setGenerationKind(generationId: string, kind: string): Promise<void> {
  const session = await requireSession()
  const gen = await db.query.generations.findFirst({ where: (g) => eq(g.id, generationId) })
  if (!gen || gen.userId !== session.userId || gen.chosenTemplateId) redirect('/explore')
  if (!(LIST_KINDS as string[]).includes(kind) || kind === gen.listKind) redirect(`/generate/${generationId}`)

  const { allowed } = await checkRateLimit(`gen:${session.userId}`)
  if (!allowed) redirect(`/generate/${generationId}?e=ratelimited`)
  if (!(await aiQuota(session.userId, session.handle)).ok) redirect(`/generate/${generationId}?e=ai_quota`)

  const nextIdx = (await maxIdx(generationId)) + 1
  if (nextIdx > 6) redirect(`/generate/${generationId}?e=variantcap`)

  // Новый тип — источник правды для этой генерации и всех будущих витков.
  await db.update(generations).set({ listKind: kind }).where(eq(generations.id, generationId))
  await pushMessage(generationId, { attempt: nextIdx, kind: 'again', text: '' })
  await enqueueGenerate(generationId, session.userId, await threadQuery(generationId, gen.query), gen.lang, nextIdx)
  redirect(`/generate/${generationId}?v=${nextIdx}`)
}

// ── Сменить объём (короче/подробнее) → новый вариант в этом объёме ────
// Тот же приём, что и со сменой типа: пишем в колонку (её перечитает воркер) и ставим
// новый виток. Прошлые варианты остаются в ленте — сравнить объёмы можно рядом.
export async function setGenerationDetail(generationId: string, detail: string): Promise<void> {
  const session = await requireSession()
  const gen = await db.query.generations.findFirst({ where: (g) => eq(g.id, generationId) })
  if (!gen || gen.userId !== session.userId || gen.chosenTemplateId) redirect('/explore')
  if (!(DETAIL_LEVELS as string[]).includes(detail) || detail === toDetail(gen.detail)) redirect(`/generate/${generationId}`)

  const { allowed } = await checkRateLimit(`gen:${session.userId}`)
  if (!allowed) redirect(`/generate/${generationId}?e=ratelimited`)
  if (!(await aiQuota(session.userId, session.handle)).ok) redirect(`/generate/${generationId}?e=ai_quota`)

  const nextIdx = (await maxIdx(generationId)) + 1
  if (nextIdx > 6) redirect(`/generate/${generationId}?e=variantcap`)

  await db.update(generations).set({ detail }).where(eq(generations.id, generationId))
  await pushMessage(generationId, { attempt: nextIdx, kind: 'again', text: '' })
  await enqueueGenerate(generationId, session.userId, await threadQuery(generationId, gen.query), gen.lang, nextIdx)
  redirect(`/generate/${generationId}?v=${nextIdx}`)
}

// ── Дополнить прямо в чате: реплика пользователя → ещё вариант с учётом ВСЕЙ нити ──────
export async function refineInChat(generationId: string, text: string): Promise<void> {
  const session = await requireSession()
  const gen = await db.query.generations.findFirst({ where: (g) => eq(g.id, generationId) })
  if (!gen || gen.userId !== session.userId || gen.chosenTemplateId) redirect('/explore')

  const note = text.trim().slice(0, 300)
  if (!note) redirect(`/generate/${generationId}`)

  const { allowed } = await checkRateLimit(`gen:${session.userId}`)
  if (!allowed) redirect(`/generate/${generationId}?e=ratelimited`)
  if (!(await aiQuota(session.userId, session.handle)).ok) redirect(`/generate/${generationId}?e=ai_quota`)

  const nextIdx = (await maxIdx(generationId)) + 1
  if (nextIdx > 6) redirect(`/generate/${generationId}?e=variantcap`)

  // Реплику пишем ДО постановки джобы: воркер соберёт нить уже вместе с ней.
  await pushMessage(generationId, { attempt: nextIdx, kind: 'user', text: note })
  await enqueueGenerate(generationId, session.userId, await threadQuery(generationId, gen.query), gen.lang, nextIdx)
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

  const max = await maxIdx(generationId)
  const nextIdx = max + 1
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

  // #2: клеймим АТОМАРНО (get+delete одной операцией — GETDEL/Lua на Redis, single-thread в памяти).
  // Параллельный double-submit (Enter+клик / две вкладки) увидит пусто и не задвоит джобу idx=1
  // (иначе UNIQUE(generationId,idx) → упавшая джоба).
  const questions = await claimClarify(generationId)
  if (!questions.length) redirect(`/generate/${generationId}`) // нечего уточнять (протухло/ответили/выиграл другой submit)

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
      // section раньше хардкодился '' — принятые AI-рецепты становились плоскими.
      section: it.section ?? '',
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
  // Тип списка переезжает на template — иначе он умирал вместе с generation,
  // и садовник/refine не знали, что перед ними рецепт (ломали структуру).
  if (gen.listKind) await db.update(templates).set({ listKind: gen.listKind }).where(eq(templates.id, list.id))
  await enqueueReindex(list.id) // авто-индексация в поиск (через очередь)

  redirect(`/${await ownerHandle(session.userId)}/${slug}`)
}

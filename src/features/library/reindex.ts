import { and, eq, inArray } from 'drizzle-orm'
import { db, embeddings, listLinks, templates, users } from '@/shared/db'
import { extractWikiRefs } from '@/shared/lib/wiki-links'
import { flat, stepChunkContent } from './index-content'

// Сбор контента для индексации: каждый СПИСОК → один чанк 'list' (заголовок +
// описание + теги + пункты текущей версии) ПЛЮС по чанку 'step' на каждый
// содержательный шаг (KAG-lite шаг 1: retrieval достаёт отдельные шаги, а не
// только списки целиком). refId у обоих видов = template.id — чистка сирот
// и ридеры-джойны работают без изменений; якорь шага лежит в metadata.n.
export interface Item {
  kind: 'list' | 'step'
  refId: string
  content: string
  metadata: Record<string, unknown>
  /** Публично видимый список (published+public+active). Приватные/черновики/снятые
   *  ИНДЕКСИРУЕМ (вектор нужен владельцу для семантического поиска СВОИХ списков —
   *  visibleFilter(viewerId)), но их плейнтекст content/metadata в корпус НЕ пишем
   *  (defense-in-depth: неосторожный будущий ридер embeddings не выдаст приватку). */
  isPublic: boolean
}

/** templateId — точечный режим (фикс по ревью: реиндекс одного списка грузил ВЕСЬ корпус). */
export async function collectItems(templateId?: string): Promise<Item[]> {
  const tpls = await db.query.templates.findMany({
    ...(templateId ? { where: (t, { eq: eqOp }) => eqOp(t.id, templateId) } : {}),
    with: {
      owner: true,
      versions: { with: { steps: { orderBy: (s, { asc }) => asc(s.n) } }, orderBy: (v, { desc }) => desc(v.version) },
    },
  })

  return tpls.flatMap((tpl) => {
    const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
    const steps = cur?.steps ?? []
    const title = flat(tpl.title)
    const stepLines = steps.map(
      (s, i) =>
        `${i + 1}. ${flat(s.title)}${flat(s.desc) ? ` — ${flat(s.desc)}` : ''}${s.command ? ` [${s.command}]` : ''}`,
    )
    const content = [
      title,
      flat(tpl.desc),
      tpl.tags.length ? `Tags: ${tpl.tags.join(', ')}` : '',
      ...stepLines,
    ]
      .filter(Boolean)
      .join('\n')
    const base = { slug: tpl.slug, ownerHandle: tpl.owner.handle, title }
    // Синхронно с visibleFilter()/findPrecedents: публично видим = published+public+active.
    const isPublic = tpl.visibility === 'public' && tpl.status === 'published' && tpl.moderation === 'active'
    const listItem: Item = { kind: 'list', refId: tpl.id, content, metadata: base, isPublic }
    const stepItems: Item[] = steps.flatMap((s) => {
      const chunk = stepChunkContent(title, s)
      return chunk
        ? [{ kind: 'step' as const, refId: tpl.id, content: chunk, metadata: { ...base, n: s.n, stepTitle: flat(s.title) }, isPublic }]
        : []
    })
    return [listItem, ...stepItems]
  })
}

/** Чистка индекса от осиротевших (удалённых) списков. */
export async function purgeStaleEmbeddings(activeRefIds?: Set<string>): Promise<{ removed: number }> {
  const active = activeRefIds ?? new Set((await collectItems()).map((i) => i.refId))
  const all = await db.select({ id: embeddings.id, refId: embeddings.refId }).from(embeddings)
  const staleIds = all.filter((e) => e.refId != null && !active.has(e.refId)).map((e) => e.id)
  for (let i = 0; i < staleIds.length; i += 500) {
    await db.delete(embeddings).where(inArray(embeddings.id, staleIds.slice(i, i + 500)))
  }
  return { removed: staleIds.length }
}

/** Пересобрать вики-связи списка (HQ §11): [[handle/slug]] из уже собранного
 *  текста → list_links. Сбой связей не роняет реиндекс (ссылки — не индекс). */
async function rebuildWikiLinks(templateId: string, contents: string[]): Promise<void> {
  try {
    await db.delete(listLinks).where(eq(listLinks.fromId, templateId))
    const refs = extractWikiRefs(contents.join('\n'))
    if (!refs.length) return
    const rows: { fromId: string; toId: string }[] = []
    for (const r of refs) {
      const [t] = await db
        .select({ id: templates.id })
        .from(templates)
        .innerJoin(users, eq(users.id, templates.ownerId))
        .where(and(eq(users.handle, r.handle), eq(templates.slug, r.slug)))
        .limit(1)
      if (t && t.id !== templateId) rows.push({ fromId: templateId, toId: t.id })
    }
    if (rows.length) await db.insert(listLinks).values(rows).onConflictDoNothing()
  } catch (e) {
    console.warn('[wiki-links] rebuild failed', e instanceof Error ? e.message : e)
  }
}

/** Точечная переиндексация одного списка (или удаление из индекса, если его нет).
 *  Список + его шаги эмбеддятся ОДНИМ батч-вызовом (embedTexts) — не по HTTP на шаг. */
export async function reindexList(templateId: string): Promise<void> {
  /**
   * ПИШЕМ ТОЛЬКО ТО, ЧТО ЕЩЁ АКТУАЛЬНО.
   *
   * Две джобы по одному списку могут идти внахлёст (публикация ставит свою поверх идущей),
   * и порядок их завершения очередью не гарантирован. Снимок «список ещё черновик»,
   * собранный раньше, дописывался ПОСЛЕ свежего и стирал публичный эмбеддинг — список
   * исчезал из смыслового поиска, хотя проход только что был (находка авто-ревью по #819).
   *
   * Замка тут быть не может: между сбором и записью идёт вызов модели, и держать на нём
   * транзакцию нельзя. Поэтому сверка снимка: запомнили состояние до сбора, перед записью
   * перечитали. Разошлось — записывать не наше дело, свежий проход уже идёт или поставлен.
   */
  const snapshot = async () => {
    const [row] = await db
      .select({ updatedAt: templates.updatedAt, status: templates.status, visibility: templates.visibility })
      .from(templates)
      .where(eq(templates.id, templateId))
    return row ? `${row.updatedAt?.toISOString() ?? ''}|${row.status}|${row.visibility}` : ''
  }

  const before = await snapshot()
  const mine = await collectItems(templateId)
  const vecs = mine.length ? await (await import('@/shared/ai/embeddings')).embedTexts(mine.map((i) => i.content), 'doc') : null

  await db.transaction(async (tx) => {
    // Состояние читаем ВНУТРИ транзакции записи: снаружи между проверкой и записью снова
    // осталось бы окно.
    const [fresh] = await tx
      .select({ updatedAt: templates.updatedAt, status: templates.status, visibility: templates.visibility })
      .from(templates)
      .where(eq(templates.id, templateId))
    const now = fresh ? `${fresh.updatedAt?.toISOString() ?? ''}|${fresh.status}|${fresh.visibility}` : ''
    if (now !== before) return // список уехал вперёд — его переиндексирует свежий проход
    await tx.delete(embeddings).where(eq(embeddings.refId, templateId))
    await rebuildWikiLinks(templateId, mine.map((i) => i.content))
    if (!mine.length) return
    await tx.insert(embeddings).values(
      mine.map((it, i) => ({
        kind: it.kind,
        refId: it.refId,
        // Вектор уже посчитан из ПОЛНОГО текста; приватный плейнтекст в корпус не пишем.
        content: it.isPublic ? it.content : '',
        embedding: vecs?.[i] ?? null,
        metadata: it.isPublic ? it.metadata : { private: true },
      })),
    )
  })
}


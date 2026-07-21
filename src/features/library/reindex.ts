import { eq, inArray } from 'drizzle-orm'
import { db, embeddings } from '@/shared/db'
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
}

export async function collectItems(): Promise<Item[]> {
  const tpls = await db.query.templates.findMany({
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
    const listItem: Item = { kind: 'list', refId: tpl.id, content, metadata: base }
    const stepItems: Item[] = steps.flatMap((s) => {
      const chunk = stepChunkContent(title, s)
      return chunk ? [{ kind: 'step' as const, refId: tpl.id, content: chunk, metadata: { ...base, n: s.n, stepTitle: flat(s.title) } }] : []
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

/** Точечная переиндексация одного списка (или удаление из индекса, если его нет).
 *  Список + его шаги эмбеддятся ОДНИМ батч-вызовом (embedTexts) — не по HTTP на шаг. */
export async function reindexList(templateId: string): Promise<void> {
  const items = await collectItems()
  const mine = items.filter((i) => i.refId === templateId)
  await db.delete(embeddings).where(eq(embeddings.refId, templateId))
  if (!mine.length) return
  const { embedTexts } = await import('@/shared/ai/embeddings')
  const vecs = await embedTexts(mine.map((i) => i.content), 'doc') // модель/мерность диктует пространство индекса (embed-space)
  await db.insert(embeddings).values(
    mine.map((it, i) => ({
      kind: it.kind,
      refId: it.refId,
      content: it.content,
      embedding: vecs?.[i] ?? null,
      metadata: it.metadata,
    })),
  )
}

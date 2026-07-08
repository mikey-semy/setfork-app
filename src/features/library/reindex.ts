import { eq, inArray } from 'drizzle-orm'
import { db, embeddings } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

// Сбор контента для индексации: каждый СПИСОК → один чанк (заголовок + описание
// + теги + пункты текущей версии). Один вид — 'list'.
export interface Item {
  kind: 'list'
  refId: string
  content: string
  metadata: Record<string, unknown>
}

function flat(t: LocaleText | null | undefined): string {
  if (!t) return ''
  return Object.values(t).filter(Boolean).join(' / ')
}

export async function collectItems(): Promise<Item[]> {
  const tpls = await db.query.templates.findMany({
    with: {
      owner: true,
      versions: { with: { steps: { orderBy: (s, { asc }) => asc(s.n) } }, orderBy: (v, { desc }) => desc(v.version) },
    },
  })

  return tpls.map((tpl) => {
    const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
    const steps = cur?.steps ?? []
    const stepLines = steps.map(
      (s, i) =>
        `${i + 1}. ${flat(s.title)}${flat(s.desc) ? ` — ${flat(s.desc)}` : ''}${s.command ? ` [${s.command}]` : ''}`,
    )
    const content = [
      flat(tpl.title),
      flat(tpl.desc),
      tpl.tags.length ? `Tags: ${tpl.tags.join(', ')}` : '',
      ...stepLines,
    ]
      .filter(Boolean)
      .join('\n')
    return {
      kind: 'list' as const,
      refId: tpl.id,
      content,
      metadata: { slug: tpl.slug, ownerHandle: tpl.owner.handle, title: flat(tpl.title) },
    }
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

/** Точечная переиндексация одного списка (или удаление из индекса, если его нет). */
export async function reindexList(templateId: string): Promise<void> {
  const items = await collectItems()
  const item = items.find((i) => i.refId === templateId)
  await db.delete(embeddings).where(eq(embeddings.refId, templateId))
  if (!item) return
  const [{ getAiSettings }, { embedOne }] = await Promise.all([import('@/shared/settings/ai'), import('@/shared/ai/embeddings')])
  const { embeddingModel } = await getAiSettings()
  const vec = await embedOne(item.content, embeddingModel)
  await db.insert(embeddings).values({
    kind: item.kind,
    refId: item.refId,
    content: item.content,
    embedding: vec,
    metadata: item.metadata,
  })
}

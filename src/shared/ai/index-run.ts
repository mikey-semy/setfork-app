import 'server-only'
import { inArray } from 'drizzle-orm'
import { db, embeddings } from '@/shared/db'
import { getSettings, saveSettings } from '@/shared/settings/kv'
import { getAiSettings } from '@/shared/settings/ai'
import { collectItems, purgeStaleEmbeddings } from '@/features/library/reindex'
import { embedTexts } from './embeddings'

// «Умная» переиндексация: батчами, разнесёнными по времени, с кулдауном.
// Состояние персистентно (app_settings JSON, ключ index_run) — переживает рестарт.

const STATE_KEY = 'index_run'
const BATCH = 32
export const COOLDOWN_MS = 30 * 60 * 1000

export interface IndexSegment {
  kind: string
  count: number
}

interface PersistState {
  status: 'idle' | 'running' | 'done' | 'error'
  total: number
  done: number
  spreadMs: number
  segments: IndexSegment[]
  vectorized: boolean
  error: string | null
  startedAt: number | null
  finishedAt: number | null
  lastBeat: number
  staleAfterMs: number
}

export interface IndexRunView {
  status: PersistState['status']
  total: number
  doneItems: number
  segments: IndexSegment[]
  vectorized: boolean
  error: string | null
  stalled: boolean
  cooldownUntil: number
  cooldownMs: number
}

const g = globalThis as unknown as { __shLoopActive?: boolean }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function emptyState(): PersistState {
  return {
    status: 'idle',
    total: 0,
    done: 0,
    spreadMs: 0,
    segments: [],
    vectorized: false,
    error: null,
    startedAt: null,
    finishedAt: null,
    lastBeat: 0,
    staleAfterMs: 0,
  }
}

async function readState(): Promise<PersistState> {
  const map = await getSettings([STATE_KEY])
  const raw = map[STATE_KEY]
  if (!raw) return emptyState()
  try {
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<PersistState>) }
  } catch {
    return emptyState()
  }
}

async function writeState(s: PersistState): Promise<void> {
  await saveSettings({ [STATE_KEY]: JSON.stringify(s) })
}

function isStalled(s: PersistState): boolean {
  if (s.status !== 'running') return false
  const beat = s.lastBeat || s.startedAt || 0
  if (!beat) return false
  return Date.now() - beat > (s.staleAfterMs || 90_000)
}

function computeSegments(items: { kind: string }[]): IndexSegment[] {
  const segs: IndexSegment[] = []
  for (const it of items) {
    const last = segs[segs.length - 1]
    if (last && last.kind === it.kind) last.count++
    else segs.push({ kind: it.kind, count: 1 })
  }
  return segs
}

export async function getIndexRun(): Promise<IndexRunView> {
  const s = await readState()
  if (s.status === 'running' && !g.__shLoopActive) {
    g.__shLoopActive = true
    void runLoop(s.spreadMs, s.done).catch(() => {})
  }
  return {
    status: s.status,
    total: s.total,
    doneItems: Math.min(s.done, s.total || s.done),
    segments: s.segments,
    vectorized: s.vectorized,
    error: s.error,
    stalled: isStalled(s) && !g.__shLoopActive,
    cooldownUntil: (s.finishedAt ?? 0) + COOLDOWN_MS,
    cooldownMs: COOLDOWN_MS,
  }
}

export async function startIndexRun(spreadMs: number): Promise<{ ok: true } | { error: string }> {
  const s = await readState()
  const stalled = isStalled(s)
  if (s.status === 'running' && g.__shLoopActive && !stalled) return { error: 'Индексация уже идёт.' }
  if (!stalled) {
    const left = (s.finishedAt ?? 0) + COOLDOWN_MS - Date.now()
    if (left > 0) return { error: `Слишком часто. Повторите через ${Math.ceil(left / 60000)} мин.` }
  }
  const fresh: PersistState = {
    ...emptyState(),
    status: 'running',
    spreadMs: Math.max(0, spreadMs),
    startedAt: Date.now(),
    lastBeat: Date.now(),
  }
  await writeState(fresh)
  g.__shLoopActive = true
  void runLoop(fresh.spreadMs, 0).catch(() => {})
  return { ok: true }
}

async function runLoop(spreadMs: number, startDone: number): Promise<void> {
  g.__shLoopActive = true
  try {
    const { embeddingModel } = await getAiSettings()
    const items = await collectItems()
    const total = items.length
    const segments = computeSegments(items)
    const nBatches = Math.max(1, Math.ceil(total / BATCH))
    const startBatch = Math.min(Math.max(0, Math.floor(startDone / BATCH)), nBatches)
    const delay = nBatches > 1 ? Math.floor(spreadMs / (nBatches - 1)) : 0
    const staleAfterMs = delay + 60_000

    const prev = await readState()
    const base: PersistState = {
      ...prev,
      status: 'running',
      total,
      segments,
      spreadMs,
      staleAfterMs,
      error: null,
      finishedAt: null,
      startedAt: prev.startedAt ?? Date.now(),
    }
    let done = Math.min(startBatch * BATCH, total)
    let anyVec = false
    const deleted = new Set<string>()

    await writeState({ ...base, done, lastBeat: Date.now() })

    for (let i = startBatch; i < nBatches; i++) {
      const slice = items.slice(i * BATCH, (i + 1) * BATCH)
      try {
        const vecs = await embedTexts(
          slice.map((it) => it.content),
          embeddingModel,
        )
        if (vecs) anyVec = true
        const toDelete = [...new Set(slice.map((it) => it.refId))].filter((r) => !deleted.has(r))
        if (toDelete.length) {
          await db.delete(embeddings).where(inArray(embeddings.refId, toDelete))
          toDelete.forEach((r) => deleted.add(r))
        }
        await db.insert(embeddings).values(
          slice.map((it, j) => ({
            kind: it.kind,
            refId: it.refId,
            content: it.content,
            embedding: vecs ? vecs[j] : null,
            metadata: it.metadata,
          })),
        )
        done = Math.min(done + slice.length, total)
      } catch (e) {
        console.warn(`[reindex] batch ${i + 1}/${nBatches} failed:`, e instanceof Error ? e.message : e)
      }
      await writeState({ ...base, done, vectorized: anyVec, lastBeat: Date.now() })
      if (i < nBatches - 1 && delay > 0) await sleep(delay)
    }

    try {
      await purgeStaleEmbeddings(new Set(items.map((it) => it.refId)))
    } catch (e) {
      console.warn('[reindex] purge failed:', e instanceof Error ? e.message : e)
    }

    await writeState({
      ...base,
      status: 'done',
      done,
      vectorized: anyVec,
      finishedAt: Date.now(),
      lastBeat: Date.now(),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    const s = await readState()
    await writeState({ ...s, status: 'error', error: msg })
  } finally {
    g.__shLoopActive = false
  }
}

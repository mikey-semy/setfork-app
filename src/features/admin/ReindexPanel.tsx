'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Loader2, Sparkles } from 'lucide-react'
import { getReindexStatus, purgeEmbeddings, startReindex } from './actions'

type Status = Awaited<ReturnType<typeof getReindexStatus>>

const ROWS = 7

/** Переиндексация эмбеддингов: прогресс сеткой-прямоугольником (как контрибуции
 *  на GitHub) — клетки наполняются долей прогресса; серый — ждёт, красный — ошибка. */
export function ReindexPanel({ ru }: { ru: boolean }) {
  const [spread, setSpread] = useState(0)
  const [status, setStatus] = useState<Status>(null)
  const [starting, setStarting] = useState(false)
  const [purging, setPurging] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [now, setNow] = useState(0)
  const [gridWidth, setGridWidth] = useState(0)

  const roRef = useRef<ResizeObserver | null>(null)
  const gridRef = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (node) {
      const ro = new ResizeObserver((entries) => setGridWidth(entries[0]?.contentRect.width ?? 0))
      ro.observe(node)
      roRef.current = ro
    }
  }, [])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const s = await getReindexStatus()
      if (alive) setStatus(s)
    }
    void tick()
    const poll = setInterval(tick, 1500)
    const clock = setInterval(() => alive && setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => {
      alive = false
      clearInterval(poll)
      clearInterval(clock)
    }
  }, [])

  const stalled = status?.stalled ?? false
  const running = status?.status === 'running' && !stalled
  const cooldownLeft = status ? Math.max(0, status.cooldownUntil - now) : 0
  const onCooldown = !running && !stalled && cooldownLeft > 0 && status?.status !== 'idle'
  const pct = status && status.total ? Math.round((status.doneItems / status.total) * 100) : 0

  const cols = gridWidth > 0 ? Math.max(1, Math.min(60, Math.floor(gridWidth / 14))) : 24
  const totalCells = ROWS * cols
  const ratio = status && status.total > 0 ? status.doneItems / status.total : 0
  const greenCells = Math.round(ratio * totalCells)
  const finished = status?.status === 'done' || status?.status === 'error'
  const hasErrors = !!status && (status.status === 'error' || (finished && status.doneItems < status.total))

  const start = async () => {
    setStarting(true)
    setMsg(null)
    const res = await startReindex(spread)
    setStarting(false)
    if ('error' in res) setMsg(res.error)
    else setStatus(await getReindexStatus())
  }
  const purge = async () => {
    setPurging(true)
    setMsg(null)
    const res = await purgeEmbeddings()
    setPurging(false)
    setMsg('error' in res ? res.error : ru ? `Удалено осиротевших: ${res.removed}` : `Removed orphaned: ${res.removed}`)
  }

  const btn = 'inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-semibold disabled:opacity-60'

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-1 font-semibold text-ink">{ru ? 'Индексация поиска (эмбеддинги)' : 'Search index (embeddings)'}</div>
      <p className="mb-3 text-[13px] text-ink-2">
        {ru
          ? 'Пересчёт векторного индекса списков. Идёт батчами, не чаще раза в 30 минут.'
          : 'Rebuild the vector index of lists. Runs in batches, at most once per 30 min.'}
      </p>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="mb-1 block text-[12px] text-ink-2">{ru ? 'Разнести на, мин' : 'Spread over, min'}</label>
          <input
            type="number"
            min={0}
            max={120}
            value={spread}
            disabled={running}
            onChange={(e) => setSpread(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
            className="w-24 rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={purge} disabled={purging || running} className={`${btn} border border-border text-ink hover:border-border-strong`}>
            {purging ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />}
            {ru ? 'Почистить' : 'Purge'}
          </button>
          <button onClick={start} disabled={running || onCooldown || starting} className={`${btn} bg-primary text-primary-fg`}>
            {running || starting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {running
              ? ru
                ? 'Индексируем…'
                : 'Indexing…'
              : onCooldown
                ? ru
                  ? `Через ${Math.ceil(cooldownLeft / 60000)} мин`
                  : `In ${Math.ceil(cooldownLeft / 60000)} min`
                : ru
                  ? 'Запустить'
                  : 'Run'}
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 text-[12.5px] text-ink-2">{msg}</div>}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[12px] text-muted">
          <span>
            {stalled
              ? ru
                ? 'Прервано — запустите заново'
                : 'Interrupted — run again'
              : running
                ? ru
                  ? 'Индексируем…'
                  : 'Indexing…'
                : status?.status === 'done'
                  ? ru
                    ? `Готово${status.vectorized ? '' : ' (без векторов — нет ключа)'}`
                    : `Done${status.vectorized ? '' : ' (no vectors — no key)'}`
                  : status?.status === 'error'
                    ? `${ru ? 'Ошибка' : 'Error'}: ${status.error ?? ''}`
                    : ru
                      ? 'Индекс ещё не построен'
                      : 'Not indexed yet'}
          </span>
          <span className="font-mono">
            {status?.doneItems ?? 0}/{status?.total ?? 0} · {pct}%
          </span>
        </div>
        <div
          ref={gridRef}
          className="grid w-full grid-flow-col gap-0.5"
          style={{ gridTemplateRows: `repeat(${ROWS}, auto)`, gridAutoColumns: 'minmax(0, 1fr)' }}
        >
          {Array.from({ length: totalCells }, (_, i) => {
            const filled = i < greenCells
            const errored = !filled && finished && hasErrors
            return (
              <span
                key={i}
                className={`h-3 w-full rounded-[2px] transition-colors ${
                  filled ? 'animate-cell-pop bg-[var(--ok)]' : errored ? 'bg-[var(--danger)]' : 'bg-[var(--border)]'
                }`}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

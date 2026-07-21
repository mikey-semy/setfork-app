'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Loader2, Sparkles } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { getEmbedSpaceInfo, getReindexStatus, purgeEmbeddings, setEmbedTarget, startReindex } from './actions'

type Status = Awaited<ReturnType<typeof getReindexStatus>>
type SpaceInfo = Awaited<ReturnType<typeof getEmbedSpaceInfo>>

const ROWS = 7

/** Переиндексация эмбеддингов: прогресс сеткой-прямоугольником (как контрибуции
 *  на GitHub) — клетки наполняются долей прогресса; серый — ждёт, красный — ошибка. */
export function ReindexPanel({ ru }: { ru: boolean }) {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [spread, setSpread] = useState(0)
  const [status, setStatus] = useState<Status>(null)
  const [space, setSpace] = useState<SpaceInfo>(null)
  const [switching, setSwitching] = useState(false)
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
      const [s, sp] = await Promise.all([getReindexStatus(), getEmbedSpaceInfo()])
      if (alive) {
        setStatus(s)
        setSpace(sp)
      }
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
    setMsg('error' in res ? res.error : say(`Removed orphaned: ${res.removed}`, `Удалено осиротевших: ${res.removed}`))
  }

  const btn = 'inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-semibold disabled:opacity-60'

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-1 font-semibold text-ink">{say('Search index (embeddings)', 'Индексация поиска (эмбеддинги)')}</div>
      <p className="mb-3 text-[13px] text-ink-2">
        {say('Rebuild the vector index of lists. Runs in batches, at most once per 30 min.', 'Пересчёт векторного индекса списков. Идёт батчами, не чаще раза в 30 минут.')}
      </p>

      {space && (
        <div className={`mb-4 rounded-md border p-3 ${space.inSync ? 'border-border bg-surface-2' : 'border-warn/50 bg-warn/10'}`}>
          <div className="flex flex-wrap items-center gap-3">
            {/* Мерность — крупным бейджем: в чём реально построен индекс */}
            <span className="inline-flex items-baseline gap-1 rounded-md bg-primary px-2.5 py-1.5 font-mono text-primary-fg">
              <span className="text-[18px] font-bold leading-none">{space.index.dim}</span>
              <span className="text-[10px] uppercase opacity-80">{say('dim', 'мерн.')}</span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-ink">
                {say('Index space:', 'Пространство индекса:')}
                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11.5px] font-semibold">
                  {space.index.provider === 'yandex' ? 'Yandex v2 🇷🇺' : 'OpenRouter'}
                </span>
                <span className="truncate font-mono text-[11.5px] text-ink-2">{space.index.docModel}</span>
              </div>
              <div className="mt-0.5 text-[12px] text-muted">
                {space.vectorized}/{space.rows} {say('rows vectorized', 'строк с векторами')}
                {space.index.at ? ` · ${say('reindexed', 'реиндекс')} ${new Date(space.index.at).toLocaleString()}` : ''}
              </div>
            </div>
          </div>
          {!space.inSync && (
            <div className="mt-2 text-[12.5px] font-medium text-warn">
              {say(`Target changed: ${space.target.provider === 'yandex' ? 'Yandex v2' : 'OpenRouter'} (${space.target.dim}-dim) — run a reindex to rebuild. Old vectors will be wiped.`, `Цель изменена: ${space.target.provider === 'yandex' ? 'Yandex v2' : 'OpenRouter'} (${space.target.dim}-мерное) — запусти реиндекс, чтобы перестроить индекс. Старые векторы будут стёрты.`)}
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <label className="text-[12px] text-ink-2">{say('Target:', 'Цель:')}</label>
            <Select
              value={space.target.provider}
              disabled={switching || running}
              onValueChange={async (v) => {
                setSwitching(true)
                const res = await setEmbedTarget(v)
                if ('error' in res) setMsg(res.error)
                setSpace(await getEmbedSpaceInfo())
                setSwitching(false)
              }}
            >
              <SelectTrigger className="h-auto w-auto min-w-[190px] px-2 py-1 text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openrouter">OpenRouter · 1536</SelectItem>
                <SelectItem value="yandex">Yandex v2 · 768 🇷🇺</SelectItem>
              </SelectContent>
            </Select>
            {switching && <Loader2 size={13} className="animate-spin text-muted" />}
          </div>
        </div>
      )}

      <div className="mb-3">
        <label className="mb-1 block text-[12px] text-ink-2">{say('Spread over, min', 'Разнести на, мин')}</label>
        <input
          type="number"
          min={0}
          max={120}
          value={spread}
          disabled={running}
          onChange={(e) => setSpread(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
          className="w-24 rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-hidden"
        />
      </div>

      {msg && <div className="mb-3 text-[12.5px] text-ink-2">{msg}</div>}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[12px] text-muted">
          <span>
            {stalled
              ? say('Interrupted — run again', 'Прервано — запустите заново')
              : running
                ? say('Indexing…', 'Индексируем…')
                : status?.status === 'done'
                  ? say(`Done${status.vectorized ? '' : ' (no vectors — no key)'}`, `Готово${status.vectorized ? '' : ' (без векторов — нет ключа)'}`)
                  : status?.status === 'error'
                    ? `${say('Error', 'Ошибка')}: ${status.error ?? ''}`
                    : say('Not indexed yet', 'Индекс ещё не построен')}
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
                  filled ? 'animate-cell-pop bg-ok' : errored ? 'bg-danger' : 'bg-(--border)'
                }`}
              />
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
        <button onClick={purge} disabled={purging || running} className={`${btn} border border-border text-ink hover:border-border-strong`}>
          {purging ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />}
          {say('Purge', 'Почистить')}
        </button>
        <button onClick={start} disabled={running || onCooldown || starting} className={`${btn} bg-primary text-primary-fg`}>
          {running || starting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {running
            ? say('Indexing…', 'Индексируем…')
            : onCooldown
              ? say(`In ${Math.ceil(cooldownLeft / 60000)} min`, `Через ${Math.ceil(cooldownLeft / 60000)} мин`)
              : say('Run', 'Запустить')}
        </button>
      </div>
    </div>
  )
}

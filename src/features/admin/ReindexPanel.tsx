'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Sparkles } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { getEmbedSpaceInfo, getReindexStatus, purgeEmbeddings, setEmbedTarget, startReindex } from './actions'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'
import { cardClass } from '@/shared/ui/card-style'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'

type Status = Awaited<ReturnType<typeof getReindexStatus>>
type SpaceInfo = Awaited<ReturnType<typeof getEmbedSpaceInfo>>

const ROWS = 7

/** Как называем провайдера эмбеддингов — одна таблица на панель: тот же тернарник
 *  стоял в трёх местах и в каждом писал своё («Yandex v2 🇷🇺», «Yandex v2»,
 *  «Yandex v2 · 768 🇷🇺»). Незнакомого показываем как есть, а не чужим именем.
 *  Мерность в подпись не вписываем — она приходит из схемы (columnDim). */
const PROVIDER_LABEL: Record<string, string> = { openrouter: 'OpenRouter', yandex: 'Yandex v2 🇷🇺' }
const providerLabel = (provider: string) => PROVIDER_LABEL[provider] ?? provider

/** Что сказать про мерность цели. Число берём РОДНОЕ (targetNativeDim), а не target.dim:
 *  у модели шире колонки второе уже урезано, и усечение выглядело бы точным попаданием. */
function targetDimText(space: NonNullable<SpaceInfo>, lang: Lang): string {
  const native = space.targetNativeDim
  if (native === null) return t('admin.targetDimUnknown', lang).replace('{c}', String(space.columnDim))
  const key = native > space.columnDim ? 'admin.targetDimTruncated' : 'admin.targetDimMeasured'
  return t(key, lang).replace('{d}', String(native)).replace('{c}', String(space.columnDim))
}

/** Переиндексация эмбеддингов: прогресс сеткой-прямоугольником (как контрибуции
 *  на GitHub) — клетки наполняются долей прогресса; серый — ждёт, красный — ошибка. */
export function ReindexPanel({ lang }: { lang: Lang }) {
  const ru = lang === 'ru'
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

  // Колонки считаем по ширине: клетка ~14px. Потолок высокий (было 60) — на мониторе
  // 1920 колонка админки даёт 1548px, и при потолке в 60 клетка выходила 23.8×12: сетка
  // расползалась лежачими прямоугольниками, потому что высота фиксированная, а ширина
  // тянется на 1fr. Клетка теперь квадратная по построению (aspect-square), так что
  // упереться в потолок = получить клетки покрупнее, а не деформированные.
  const cols = gridWidth > 0 ? Math.max(1, Math.min(120, Math.floor(gridWidth / 14))) : 24
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
    setMsg('error' in res ? res.error : t('admin.removedOrphaned', lang).replace('{n}', String(res.removed)))
  }

  const btn = 'inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-body font-semibold disabled:opacity-60'

  return (
    // Та же читаемая ширина, что у карточек-секций /admin (const card на странице):
    // без кэпа панель растягивалась на весь экран и выбивалась из колонны секций.
    <div className={cardClass({ className: 'w-full max-w-wide' })}>
      <div className="mb-1 font-semibold text-ink">{t('admin.searchIndexEmbeddings', lang)}</div>
      <p className="mb-3 text-body text-ink-2">
        {t('admin.rebuildVectorIndexLists', lang)}
      </p>

      {space && (
        <div className={cardClass({ tone: space.inSync ? 'inset' : 'warn', pad: 'sm', className: 'mb-4' })}>
          <div className="flex flex-wrap items-center gap-3">
            {/* Мерность — крупным бейджем: в чём реально построен индекс */}
            <span className="inline-flex items-baseline gap-1 rounded-md bg-primary px-2.5 py-1.5 font-mono text-primary-fg">
              <span className="text-page font-bold leading-none">{space.index.dim}</span>
              <span className="text-caption uppercase opacity-80">{t('admin.dim', lang)}</span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-body font-medium text-ink">
                {t('admin.indexSpace', lang)}
                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-caption font-semibold">
                  {providerLabel(space.index.provider)}
                </span>
                <Tooltip label={space.index.docModel}>
                  <span className="truncate font-mono text-caption text-ink-2">{space.index.docLabel}</span>
                </Tooltip>
              </div>
              <div className="mt-0.5 text-body-sm text-muted">
                {space.vectorized}/{space.rows} {t('admin.rowsVectorized', lang)}
                {space.index.at ? ` · ${t('admin.reindexed', lang)} ${new Date(space.index.at).toLocaleString()}` : ''}
              </div>
            </div>
          </div>
          {!space.inSync && (
            <div className="mt-2 text-body-sm font-medium text-warn">
              {t('admin.targetChanged', lang).replace('{p}', providerLabel(space.target.provider)).replace('{d}', String(space.target.dim))}
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <label htmlFor="reindex-target" className="text-body-sm text-ink-2">{t('admin.target', lang)}</label>
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
              <SelectTrigger id="reindex-target" className="h-auto w-auto min-w-field-lg px-2 py-1 text-body-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {space.providers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {providerLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {switching && <Spinner size="sm" className="text-muted" />}
          </div>
          {/* Мерность — свойство ВЫБРАННОЙ МОДЕЛИ, поэтому у пунктов её нет (раньше там
              стояло вписанное руками «· 1536» при колонке 768). Здесь — измеренный факт
              для текущей цели, а пока не измерен — так и сказано. */}
          <p className="mt-1.5 text-body-sm text-muted">
            {targetDimText(space, lang)}
          </p>
        </div>
      )}

      <div className="mb-3">
        <label htmlFor="reindex-spread" className="mb-1 block text-body-sm text-ink-2">{t('admin.spreadOverMin', lang)}</label>
        <input
          id="reindex-spread"
          type="number"
          min={0}
          max={120}
          value={spread}
          disabled={running}
          onChange={(e) => setSpread(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
          className={buttonClass({ className: 'w-24 bg-surface-2 outline-hidden' })}
        />
      </div>

      {msg && <div className="mb-3 text-body-sm text-ink-2">{msg}</div>}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-body-sm text-muted">
          <span>
            {stalled
              ? t('admin.interruptedRunAgain', lang)
              : running
                ? t('admin.indexing', lang)
                : status?.status === 'done'
                  ? status.vectorized
                    ? t('admin.done', lang)
                    : // Векторов нет: контент проиндексирован, но у эмбеддинг-провайдера НЕТ ключа.
                      // Называем какой именно — иначе непонятно, что настраивать (ключ эмбеддингов
                      // ≠ ключ чат-провайдера).
                      space?.index.provider === 'yandex'
                      ? t('admin.doneBut0Vectors', lang)
                      : t('admin.doneBut0Vectors2', lang)
                  : status?.status === 'error'
                    ? `${t('admin.error', lang)}: ${status.error ?? ''}`
                    : t('admin.notIndexedYet', lang)}
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
                className={`aspect-square w-full rounded-xs transition-colors ${
                  filled ? 'animate-cell-pop bg-ok' : errored ? 'bg-danger' : 'bg-border'
                }`}
              />
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={purge} disabled={purging || running} className={`${btn} border border-border text-ink hover:border-border-strong`}>
          {purging ? <Spinner size="md" /> : <Eraser size={14} />}
          {t('admin.purge', lang)}
        </button>
        <button type="button" onClick={start} disabled={running || onCooldown || starting} className={`${btn} bg-primary text-primary-fg`}>
          {running || starting ? <Spinner size="md" /> : <Sparkles size={14} />}
          {running
            ? t('admin.indexing', lang)
            : onCooldown
              ? t('admin.inMin', lang).replace('{n}', String(Math.ceil(cooldownLeft / 60000)))
              : t('admin.run', lang)}
        </button>
      </div>
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Plus, Sparkles, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { Lang } from '@/shared/i18n'
import type { LandingLang, LandingOverrides, LandingStat } from '@/shared/settings/landing'
import { LANDING_MAX_STATS, STAT_MAX, isLongKey, landingMaxLength, type LandingKey } from '@/shared/landing-keys'
import { cn } from '@/shared/lib/cn'
import { saveLanding, suggestSlogan } from './landing-actions'
import { t } from '@/shared/i18n'
import { Spinner } from '@/shared/ui/Spinner'
import { TextButton } from '@/shared/ui/TextButton'
import { IconButton } from '@/shared/ui/IconButton'
import { Segment, SegmentedControl } from '@/shared/ui/SegmentedControl'

/**
 * ПРАВКИ ЛЕНДИНГА: поле на каждый строковый ключ словаря лендинга (`LANDING_KEYS`).
 *
 * Пустое поле — не «пустой текст», а «работает словарь лендинга»: сохраняется только то,
 * что заполнено. Ключи — техническими именами: это перекрытие конкретной строки словаря,
 * и имя однозначно говорит, какой.
 *
 * Плитки полосы доверия — с источником: без него плитка не сохранится (ADR-0005).
 */
export function LandingEditor({ initial, keys, lang }: { initial: LandingOverrides; keys: readonly LandingKey[]; lang: Lang }) {
  const router = useRouter()
  const [c, setC] = useState<LandingOverrides>(initial)
  const [tab, setTab] = useState<LandingLang>('en')
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const cur = c[tab]
  const setText = (key: LandingKey, val: string) => setC((p) => ({ ...p, [tab]: { ...p[tab], texts: { ...p[tab].texts, [key]: val } } }))
  const setStats = (stats: LandingStat[]) => setC((p) => ({ ...p, [tab]: { ...p[tab], stats } }))
  const setStat = (i: number, k: keyof LandingStat, val: string) => setStats(cur.stats.map((s, j) => (j === i ? { ...s, [k]: val } : s)))

  function save() {
    setErr(null)
    start(async () => {
      const r = await saveLanding(c)
      if ('error' in r) setErr(r.error)
      else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <SegmentedControl label={t('admin.contentLang', lang)}>
        {(['en', 'ru'] as const).map((l) => (
          <Segment key={l} active={tab === l} onClick={() => setTab(l)} className="uppercase">
            {l}
          </Segment>
        ))}
      </SegmentedControl>

      <p className="text-body-sm text-ink-2">{t('admin.landingKeysHint', lang)}</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {keys.map((key) => (
          <TextField
            key={`${tab}:${key}`}
            name={key}
            area={isLongKey(key)}
            max={landingMaxLength(key)}
            value={cur.texts[key] ?? ''}
            placeholder={t('admin.landingDefault', lang)}
            onChange={(v) => setText(key, v)}
            onSuggest={() => suggestSlogan(tab, key, cur.texts[key] ?? '')}
          />
        ))}
      </div>

      <div>
        <div className="mb-1 text-body-sm font-semibold text-ink-2">{t('admin.landingStats', lang)}</div>
        <p className="mb-2 text-body-sm text-muted">{t('admin.landingStatsHint', lang)}</p>
        <div className="flex flex-col gap-2">
          {cur.stats.map((s, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]">
              <Input value={s.num} maxLength={STAT_MAX.num} onChange={(e) => setStat(i, 'num', e.target.value)} placeholder={t('admin.statNum', lang)} size="sm" />
              <Input value={s.label} maxLength={STAT_MAX.label} onChange={(e) => setStat(i, 'label', e.target.value)} placeholder={t('admin.statLabel', lang)} size="sm" />
              <Input value={s.source} maxLength={STAT_MAX.source} onChange={(e) => setStat(i, 'source', e.target.value)} placeholder={t('admin.statSource', lang)} size="sm" />
              <IconButton size="sm" variant="ghost" label={t('admin.statRemove', lang)} onClick={() => setStats(cur.stats.filter((_, j) => j !== i))}>
                <X size={14} />
              </IconButton>
            </div>
          ))}
        </div>
        {cur.stats.length < LANDING_MAX_STATS && (
          <TextButton onClick={() => setStats([...cur.stats, { num: '', label: '', source: '' }])} className="mt-2">
            <Plus size={12} /> {t('admin.statAdd', lang)}
          </TextButton>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="primary" onClick={save} disabled={pending} className="px-4 py-2 text-body-lg">
          {pending ? <Spinner size="md" /> : <Check size={15} />} {t('common.save', lang)}
        </Button>
        {saved && <span className="text-body text-ok">{t('admin.saved', lang)}</span>}
        {err && <span className="text-body text-danger">{err}</span>}
      </div>
    </div>
  )
}

// ── Поле строки словаря с AI-подсказкой ──
// Кнопка AI — ВНЕ `<label>`: иначе её подпись входила бы в доступное имя поля
// («heroTitle AI»). Поле связано с подписью через id.
function TextField({
  name,
  area,
  max,
  value,
  placeholder,
  onChange,
  onSuggest,
}: {
  name: string
  area: boolean
  max: number
  value: string
  placeholder: string
  onChange: (v: string) => void
  onSuggest: () => Promise<{ text: string } | { error: string }>
}) {
  const [busy, setBusy] = useState(false)
  const id = `landing-${name}`
  const left = max - value.length

  const suggest = async () => {
    setBusy(true)
    const r = await onSuggest()
    setBusy(false)
    if ('text' in r && r.text) onChange(r.text.slice(0, max))
  }

  return (
    <div className={area ? 'flex flex-col gap-1 sm:col-span-2' : 'flex flex-col gap-1'}>
      <span className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="font-mono text-body-sm text-ink-2">
          {name}
        </label>
        <span className={cn('font-mono text-caption', left < 0 ? 'text-danger' : 'text-muted')}>{left}</span>
      </span>
      <div className="relative">
        {area ? (
          <Textarea id={id} value={value} maxLength={max} rows={3} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="pr-9" />
        ) : (
          <Input id={id} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="pr-9" />
        )}
        <div className={area ? 'absolute right-1.5 top-1.5' : 'absolute right-1.5 top-1/2 -translate-y-1/2'}>
          <Tooltip label="AI">
            <IconButton size="xs" variant="ghost" label="AI" onClick={suggest} disabled={busy} className="text-accent hover:bg-accent-soft">
              {busy ? <Spinner size="sm" /> : <Sparkles size={13} />}
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

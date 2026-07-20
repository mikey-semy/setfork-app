'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, GitMerge, Loader2, Pencil, RefreshCw, Star, Trash2, X } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { Lang } from '@/shared/i18n'
import type { TagRow } from './queries'
import { deleteTag, mergeTags, refreshTagUsage, renameTag, setTagCurated } from './actions'

// Админ-реестр тегов: курирование, переименование, слияние, удаление, пересчёт usage.
// Экшены (requireAdmin) — в ./actions; revalidatePath('/admin/tags') + router.refresh().
export function AdminTagsTable({ tags, lang }: { tags: TagRow[]; lang: Lang }) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  const router = useRouter()
  const [pending, start] = useTransition()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<{ slug: string; mode: 'rename' | 'merge' } | null>(null)
  const [val, setVal] = useState('')

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn()
      setEdit(null)
      setVal('')
      router.refresh()
    })
  const filtered = useMemo(() => tags.filter((t) => t.slug.includes(q.trim().toLowerCase())), [tags, q])

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={say('Filter tags…', 'Фильтр тегов…')} className="max-w-[280px]" />
        <button
          type="button"
          onClick={() => run(() => refreshTagUsage())}
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:border-border-strong disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {say('Refresh usage', 'Пересчитать usage')}
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">{say('Tag', 'Тег')}</th>
              <th className="px-3 py-2 text-right font-semibold">usage</th>
              <th className="px-3 py-2 text-right font-semibold">{say('Actions', 'Действия')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tg) => (
              <tr key={tg.slug} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    {tg.curated && <Badge variant="accent">✓</Badge>}
                    <span className="font-medium text-ink">{tg.slug}</span>
                  </span>
                  {edit?.slug === tg.slug && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Input
                        autoFocus
                        value={val}
                        onChange={(e) => setVal(e.target.value)}
                        placeholder={edit.mode === 'rename' ? say('New slug', 'Новый slug') : say('Merge into…', 'Слить в…')}
                        className="max-w-[200px]"
                      />
                      <button
                        type="button"
                        onClick={() => run(() => (edit.mode === 'rename' ? renameTag(tg.slug, val) : mergeTags(tg.slug, val)))}
                        disabled={pending || !val.trim()}
                        className="grid size-7 place-items-center rounded-md bg-primary text-primary-fg disabled:opacity-50"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEdit(null)
                          setVal('')
                        }}
                        className="grid size-7 place-items-center rounded-md border border-border text-ink-2"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono text-muted">{tg.usageCount}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <IconBtn title={tg.curated ? say('Uncurate', 'Снять курирование') : say('Curate', 'Курировать')} active={tg.curated} onClick={() => run(() => setTagCurated(tg.slug, !tg.curated))}>
                      <Star size={14} />
                    </IconBtn>
                    <IconBtn title={say('Rename', 'Переименовать')} onClick={() => { setEdit({ slug: tg.slug, mode: 'rename' }); setVal('') }}>
                      <Pencil size={14} />
                    </IconBtn>
                    <IconBtn title={say('Merge', 'Слить')} onClick={() => { setEdit({ slug: tg.slug, mode: 'merge' }); setVal('') }}>
                      <GitMerge size={14} />
                    </IconBtn>
                    <IconBtn
                      title={say('Delete', 'Удалить')}
                      danger
                      onClick={() => {
                        if (confirm(say(`Delete tag "${tg.slug}"? It is removed from all lists.`, `Удалить тег «${tg.slug}»? Он исчезнет из всех списков.`))) run(() => deleteTag(tg.slug))
                      }}
                    >
                      <Trash2 size={14} />
                    </IconBtn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {filtered.length} / {tags.length}
      </p>
    </div>
  )
}

function IconBtn({ children, title, onClick, active, danger }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <Tooltip label={title}>
      <button
        type="button"
        onClick={onClick}
        className={`grid size-7 place-items-center rounded-md border border-border hover:border-border-strong ${active ? 'text-accent' : danger ? 'text-ink-2 hover:text-danger' : 'text-ink-2 hover:text-ink'}`}
      >
        {children}
      </button>
    </Tooltip>
  )
}

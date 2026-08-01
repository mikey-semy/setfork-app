'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, GitMerge, Loader2, Pencil, RefreshCw, Star, Trash2, X } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { Tooltip } from '@/shared/ui/Tooltip'
import { useConfirm } from '@/shared/ui/use-confirm'
import { t, type Lang } from '@/shared/i18n'
import type { TagRow } from './queries'
import { deleteTag, mergeTags, refreshTagUsage, renameTag, setTagCurated } from './actions'

// Админ-реестр тегов: курирование, переименование, слияние, удаление, пересчёт usage.
// Экшены (requireAdmin) — в ./actions; revalidatePath('/admin/tags') + router.refresh().
export function AdminTagsTable({ tags, lang }: { tags: TagRow[]; lang: Lang }) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  const router = useRouter()
  const { confirm, confirmDialog } = useConfirm()
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
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tags.filterTags', lang)} className="max-w-[17.5rem]" />
        <button
          type="button"
          onClick={() => run(() => refreshTagUsage())}
          disabled={pending}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1.5 text-[0.8125rem] font-medium text-ink hover:border-border-strong disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {t('tags.refreshUsage', lang)}
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[0.8125rem]">
          <thead className="bg-surface-2 text-[0.6875rem] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">{t('tags.tag', lang)}</th>
              <th className="px-3 py-2 text-right font-semibold">usage</th>
              <th className="px-3 py-2 text-right font-semibold">{t('tags.actions', lang)}</th>
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
                        placeholder={edit.mode === 'rename' ? t('tags.newSlug', lang) : t('tags.mergeInto', lang)}
                        className="max-w-[12.5rem]"
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
                    <IconBtn title={tg.curated ? t('tags.uncurate', lang) : t('tags.curate', lang)} active={tg.curated} onClick={() => run(() => setTagCurated(tg.slug, !tg.curated))}>
                      <Star size={14} />
                    </IconBtn>
                    <IconBtn title={t('common.rename', lang)} onClick={() => { setEdit({ slug: tg.slug, mode: 'rename' }); setVal('') }}>
                      <Pencil size={14} />
                    </IconBtn>
                    <IconBtn title={t('tags.merge', lang)} onClick={() => { setEdit({ slug: tg.slug, mode: 'merge' }); setVal('') }}>
                      <GitMerge size={14} />
                    </IconBtn>
                    <IconBtn
                      title={t('common.delete', lang)}
                      danger
                      onClick={async () => {
                        // Необратимая массовая операция — type-to-confirm по slug'у тега.
                        const ok = await confirm({
                          title: say(`Delete tag "${tg.slug}"?`, `Удалить тег «${tg.slug}»?`),
                          intro: t('tags.itRemovedFromAll', lang),
                          confirmLabel: t('common.delete', lang),
                          cancelLabel: t('cancel', lang),
                          confirmPhrase: tg.slug,
                          confirmHint: t('dangerConfirmHint', lang),
                        })
                        if (ok) run(() => deleteTag(tg.slug))
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
      <p className="mt-2 text-[0.78125rem] text-muted">
        {filtered.length} / {tags.length}
      </p>
      {confirmDialog}
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

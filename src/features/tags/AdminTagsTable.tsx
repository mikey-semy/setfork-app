'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, GitMerge, Pencil, RefreshCw, Star, Trash2, X } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { Tooltip } from '@/shared/ui/Tooltip'
import { useConfirm } from '@/shared/ui/use-confirm'
import { t, type Lang } from '@/shared/i18n'
import type { TagRow } from './queries'
import { deleteTag, mergeTags, refreshTagUsage, renameTag, setTagCurated } from './actions'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'
import { IconButton } from '@/shared/ui/IconButton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

// Админ-реестр тегов: курирование, переименование, слияние, удаление, пересчёт usage.
// Экшены (requireAdmin) — в ./actions; revalidatePath('/admin/tags') + router.refresh().
export function AdminTagsTable({ tags, lang }: { tags: TagRow[]; lang: Lang }) {
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
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tags.filterTags', lang)} className="max-w-panel" />
        <button
          type="button"
          onClick={() => run(() => refreshTagUsage())}
          disabled={pending}
          className={buttonClass({ className: 'ml-auto disabled:opacity-50' })}
        >
          {pending ? <Spinner size="md" /> : <RefreshCw size={14} />} {t('tags.refreshUsage', lang)}
        </button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('tags.tag', lang)}</TableHead>
            <TableHead className="text-right">usage</TableHead>
            <TableHead className="text-right">{t('tags.actions', lang)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((tg) => (
            <TableRow key={tg.slug}>
              <TableCell>
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
                        className="max-w-field-lg"
                      />
                      <IconButton
                        size="md"
                        variant="primary"
                        label={t('apply', lang)}
                        onClick={() => run(() => (edit.mode === 'rename' ? renameTag(tg.slug, val) : mergeTags(tg.slug, val)))}
                        disabled={pending || !val.trim()}
                      >
                        <Check size={14} />
                      </IconButton>
                      <IconButton
                        size="md"
                        variant="outline"
                        label={t('cancel', lang)}
                        onClick={() => {
                          setEdit(null)
                          setVal('')
                        }}
                      >
                        <X size={14} />
                      </IconButton>
                    </div>
                  )}
              </TableCell>
              <TableCell className="text-right font-mono text-muted">{tg.usageCount}</TableCell>
              <TableCell>
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
                          title: t('tags.deleteTagConfirm', lang).replace('{slug}', tg.slug),
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-2 text-body-sm text-muted">
        {filtered.length} / {tags.length}
      </p>
      {confirmDialog}
    </div>
  )
}

/** Кнопка-значок строки таблицы. Была локальной копией IconButton — и, как всякая копия,
 *  отстала: подпись жила только в тултипе, то есть у диктора кнопка молчала. */
function IconBtn({ children, title, onClick, active, danger }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <Tooltip label={title}>
      <IconButton
        size="sm"
        variant="outline"
        label={title}
        onClick={onClick}
        className={active ? 'text-accent' : danger ? 'text-ink-2 hover:text-danger' : 'text-ink-2 hover:text-ink'}
      >
        {children}
      </IconButton>
    </Tooltip>
  )
}

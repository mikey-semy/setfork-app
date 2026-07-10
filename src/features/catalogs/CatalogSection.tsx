'use client'

import { useTransition } from 'react'
import { FolderGit2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { t, tr, type Lang } from '@/shared/i18n'
import { createCatalogAndAssign, setListCatalog } from './actions'
import type { CatalogRow } from './queries'

/** Управление каталогом списка (только владелец; settings уже owner-gated). */
export function CatalogSection({
  templateId,
  currentId,
  catalogs,
  lang,
}: {
  templateId: string
  currentId: string | null
  catalogs: CatalogRow[]
  lang: Lang
}) {
  const [pending, start] = useTransition()

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-1.5 font-semibold text-ink">
        <FolderGit2 size={16} className="text-ink-2" /> {t('catalogHeading', lang)}
      </div>

      {catalogs.length > 0 && (
        <Select
          value={currentId ?? 'none'}
          onValueChange={(v) => start(() => setListCatalog(templateId, v === 'none' ? '' : v))}
          disabled={pending}
        >
          <SelectTrigger className="mb-3 w-full max-w-[320px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('noCatalogOpt', lang)}</SelectItem>
            {catalogs.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {tr(c.title, lang) || c.name} · {c.listCount}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <form action={createCatalogAndAssign.bind(null, templateId)} className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          placeholder={t('newCatalogPh', lang)}
          className="w-[240px] rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] text-ink outline-hidden focus:border-border-strong"
        />
        <button className="rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong">
          {t('createCatalogBtn', lang)}
        </button>
      </form>
    </section>
  )
}

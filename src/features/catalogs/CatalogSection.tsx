'use client'

import { useTransition } from 'react'
import { FolderGit2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { t, tr, type Lang } from '@/shared/i18n'
import { createCatalogAndAssign, setListCatalog } from './actions'
import type { CatalogRow } from './queries'
import { buttonClass } from '@/shared/ui/button-style'
import { Input } from '@/shared/ui/input'

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
    <SettingsSection
      title={
        <span className="flex items-center gap-1.5">
          <FolderGit2 size={16} className="text-ink-2" /> {t('catalogHeading', lang)}
        </span>
      }
    >
      {catalogs.length > 0 && (
        <Select
          value={currentId ?? 'none'}
          onValueChange={(v) => start(() => setListCatalog(templateId, v === 'none' ? '' : v))}
          disabled={pending}
        >
          <SelectTrigger className="mb-3 w-full max-w-panel-lg">
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
        <Input name="name"
          placeholder={t('newCatalogPh', lang)} className="w-menu" />
        <button type="submit" className={buttonClass()}>
          {t('createCatalogBtn', lang)}
        </button>
      </form>
    </SettingsSection>
  )
}

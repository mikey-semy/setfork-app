'use client'

import { Switch } from '@/shared/ui/switch'
import { t, type Lang } from '@/shared/i18n'
import type { NotifyPrefs } from '@/shared/db/schema'
import { updateNotifyPrefs } from './actions'

const ROWS: { key: keyof NotifyPrefs; labelKey: 'prefNewSuggestions' | 'prefSuggestionResolved' | 'prefStars' | 'prefForks' }[] = [
  { key: 'newSuggestions', labelKey: 'prefNewSuggestions' },
  { key: 'suggestionResolved', labelKey: 'prefSuggestionResolved' },
  { key: 'stars', labelKey: 'prefStars' },
  { key: 'forks', labelKey: 'prefForks' },
]

export function NotifyPrefsForm({ prefs, lang }: { prefs: NotifyPrefs; lang: Lang }) {
  // Отсутствие ключа = включено.
  const isOn = (k: keyof NotifyPrefs) => prefs[k] !== false

  return (
    <form action={updateNotifyPrefs} className="flex flex-col gap-4">
      {ROWS.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-4">
          <span className="text-[14px] text-ink">{t(r.labelKey, lang)}</span>
          <Switch name={r.key} defaultChecked={isOn(r.key)} />
        </div>
      ))}
      <div className="flex justify-end border-t border-border pt-4">
        <button className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
          {t('saveChanges', lang)}
        </button>
      </div>
    </form>
  )
}

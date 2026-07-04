'use client'

import { Switch } from '@/shared/ui/switch'
import { t, type Lang } from '@/shared/i18n'
import type { NotifyPrefs } from '@/shared/db/schema'
import { updateNotifyPrefs } from './actions'

const ROWS: {
  key: keyof NotifyPrefs
  labelKey: 'prefNewSuggestions' | 'prefSuggestionResolved' | 'prefStars' | 'prefForks' | 'prefIssues' | 'prefComments' | 'prefWatchedUpdates'
}[] = [
  { key: 'newSuggestions', labelKey: 'prefNewSuggestions' },
  { key: 'suggestionResolved', labelKey: 'prefSuggestionResolved' },
  { key: 'issues', labelKey: 'prefIssues' },
  { key: 'comments', labelKey: 'prefComments' },
  { key: 'watchedUpdates', labelKey: 'prefWatchedUpdates' },
  { key: 'stars', labelKey: 'prefStars' },
  { key: 'forks', labelKey: 'prefForks' },
]

export function NotifyPrefsForm({ prefs, lang, hasEmail }: { prefs: NotifyPrefs; lang: Lang; hasEmail: boolean }) {
  // Отсутствие ключа = включено (события); доставка (email/browser) — по умолчанию выключена.
  const isOn = (k: keyof NotifyPrefs) => prefs[k] !== false

  return (
    <form action={updateNotifyPrefs} className="flex flex-col gap-4">
      {ROWS.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-4">
          <span className="text-[14px] text-ink">{t(r.labelKey, lang)}</span>
          <Switch name={r.key} defaultChecked={isOn(r.key)} />
        </div>
      ))}

      {/* Доставка: дублирование включённых выше событий на почту */}
      <div className="border-t border-border pt-4">
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted">{t('deliverySection', lang)}</div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-[14px] text-ink">{t('prefEmail', lang)}</span>
            <p className="text-[12px] text-muted">{hasEmail ? t('prefEmailHint', lang) : t('prefEmailNoAddr', lang)}</p>
          </div>
          <Switch name="email" defaultChecked={prefs.email === true} disabled={!hasEmail} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <span className="text-[14px] text-ink">{t('prefBrowser', lang)}</span>
            <p className="text-[12px] text-muted">{t('prefBrowserHint', lang)}</p>
          </div>
          <Switch
            name="browser"
            defaultChecked={prefs.browser === true}
            onCheckedChange={(v) => {
              // При включении сразу спрашиваем разрешение браузера (нужен жест пользователя).
              if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission()
            }}
          />
        </div>
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <button className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
          {t('saveChanges', lang)}
        </button>
      </div>
    </form>
  )
}

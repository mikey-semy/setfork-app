'use client'

import { useState } from 'react'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { DEFAULT_LANG, isLang, LANG_META, LOCALES, t, type Lang } from '@/shared/i18n'
import type { NotifyPrefs } from '@/shared/db/schema'
import { updateNotifyPrefs } from './actions'
import { subscribeToPush, unsubscribeFromPush } from './push-client'

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

export function NotifyPrefsForm({
  prefs,
  lang,
  hasEmail,
  notifyLang = DEFAULT_LANG,
}: {
  prefs: NotifyPrefs
  lang: Lang
  hasEmail: boolean
  notifyLang?: Lang
}) {
  // Отсутствие ключа = включено (события); доставка (email/browser) — по умолчанию выключена.
  const isOn = (k: keyof NotifyPrefs) => prefs[k] !== false
  const [nl, setNl] = useState<Lang>(notifyLang)

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
              // Вкл → регистрируем SW + подписка на web-push (нужен жест пользователя);
              // выкл → отписываемся. Сам pref сохраняется по кнопке «Сохранить».
              if (v) void subscribeToPush()
              else void unsubscribeFromPush()
            }}
          />
        </div>
        {/* Язык писем/пушей (интерфейс пока English-only). */}
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <span className="text-[14px] text-ink">{t('prefLang', lang)}</span>
            <p className="text-[12px] text-muted">{t('prefLangHint', lang)}</p>
          </div>
          <input type="hidden" name="notifyLang" value={nl} />
          <Select value={nl} onValueChange={(v) => setNl(isLang(v) ? v : DEFAULT_LANG)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((l) => (
                <SelectItem key={l} value={l}>
                  {LANG_META[l].endonym}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

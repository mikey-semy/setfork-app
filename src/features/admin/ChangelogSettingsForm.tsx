'use client'

import { useState } from 'react'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { t, type Lang } from '@/shared/i18n'
import type { ChangelogSettings, ChangelogSource } from '@/shared/settings/changelog'
import { setChangelogSettings } from './actions'

const lbl = 'mb-1.5 block text-[12.5px] font-medium text-ink-2'

/**
 * Настройки публичного changelog: откуда брать и как часто.
 *
 * Тумблер выключает ВЕСЬ блок — и карточку на витрине, и страницу: пустой
 * changelog хуже отсутствующего, он выглядит поломкой.
 */
export function ChangelogSettingsForm({ current, lang }: { current: ChangelogSettings; lang: Lang }) {
  const [enabled, setEnabled] = useState(current.enabled)
  const [source, setSource] = useState<ChangelogSource>(current.source)
  const [translate, setTranslate] = useState(current.translate)

  return (
    <form action={setChangelogSettings} className="flex flex-col gap-5">
      {enabled && <input type="hidden" name="enabled" value="1" />}
      {translate && <input type="hidden" name="translate" value="1" />}
      <input type="hidden" name="source" value={source} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-ink">{t('changelogShow', lang)}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
            {t('changelogShowHint', lang)}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div>
        <label className={lbl} htmlFor="cl-repo">
          {t('changelogRepo', lang)}
        </label>
        {/* Плейсхолдер — ПРИМЕР значения, а не инструкция. */}
        <Input id="cl-repo" name="repo" defaultValue={current.repo} placeholder="mikey-semy/setfork-frontend" className="w-[320px] max-w-full" />
      </div>

      <div>
        <label className={lbl} htmlFor="cl-token">
          {t('changelogToken', lang)}
        </label>
        {/* Приватный репозиторий анонимно недоступен. Значение не показываем —
            только факт «задан»; пустое поле оставляет прежний токен. */}
        <Input
          id="cl-token"
          name="token"
          type="password"
          autoComplete="off"
          placeholder={current.hasToken ? '••••••••' : 'github_pat_…'}
          className="w-[320px] max-w-full font-mono"
        />
        <p className="mt-1 text-[11.5px] text-muted">{t('changelogTokenHint', lang)}</p>
      </div>

      <div>
        <label className={lbl} htmlFor="cl-source">
          {t('changelogWhat', lang)}
        </label>
        <Select value={source} onValueChange={(v) => setSource(v as ChangelogSource)}>
          <SelectTrigger id="cl-source" className="w-[320px] max-w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="merged">
              <span className="flex flex-col">
                <span>{t('changelogMerged', lang)}</span>
                <span className="text-[11.5px] text-muted">{t('changelogMergedHint', lang)}</span>
              </span>
            </SelectItem>
            <SelectItem value="releases">
              <span className="flex flex-col">
                <span>{t('changelogReleases', lang)}</span>
                <span className="text-[11.5px] text-muted">{t('changelogReleasesHint', lang)}</span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className={lbl} htmlFor="cl-hours">
          {t('changelogEvery', lang)}
        </label>
        <Input id="cl-hours" name="everyHours" type="number" min={1} max={168} defaultValue={current.everyHours} className="w-[120px]" />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-ink">{t('changelogTranslate', lang)}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
            {t('changelogTranslateHint', lang)}
          </p>
        </div>
        <Switch checked={translate} onCheckedChange={setTranslate} />
      </div>

      {/* Primary — справа внизу, единая высота с остальными формами админки. */}
      <div className="flex justify-end">
        <SubmitButton className="inline-flex h-[38px] items-center rounded-md bg-primary px-4 text-[13px] font-semibold text-primary-fg">
          {t('saveChanges', lang)}
        </SubmitButton>
      </div>
    </form>
  )
}

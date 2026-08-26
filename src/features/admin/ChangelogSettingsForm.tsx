'use client'

import { useState } from 'react'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import { Field } from '@/shared/ui/Field'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'
import { t, type Lang } from '@/shared/i18n'
import type { ChangelogSettings, ChangelogSource } from '@/shared/settings/changelog'
import { setChangelogSettings } from './actions'

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
          <div className="text-body font-medium text-ink">{t('changelogShow', lang)}</div>
          <p className="mt-0.5 text-body-sm leading-snug text-ink-2">
            {t('changelogShowHint', lang)}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <Field label={t('changelogRepo', lang)}>
        {/* Плейсхолдер — ПРИМЕР значения, а не инструкция. */}
        <Input name="repo" defaultValue={current.repo} placeholder="mikey-semy/setfork-frontend" className="w-panel-lg max-w-full" />
      </Field>

      <Field label={t('changelogToken', lang)} hint={t('changelogTokenHint', lang)}>
        {/* Приватный репозиторий анонимно недоступен. Значение не показываем —
            только факт «задан»; пустое поле оставляет прежний токен. */}
        <Input
          name="token"
          type="password"
          autoComplete="off"
          placeholder={current.hasToken ? '••••••••' : 'github_pat_…'}
          className="w-panel-lg max-w-full font-mono"
        />
      </Field>

      <Field label={t('changelogWhat', lang)}>
        <Select value={source} onValueChange={(v) => setSource(v as ChangelogSource)}>
          <SelectTrigger className="w-panel-lg max-w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="merged">
              <span className="flex flex-col">
                <span>{t('changelogMerged', lang)}</span>
                <span className="text-caption text-muted">{t('changelogMergedHint', lang)}</span>
              </span>
            </SelectItem>
            <SelectItem value="releases">
              <span className="flex flex-col">
                <span>{t('changelogReleases', lang)}</span>
                <span className="text-caption text-muted">{t('changelogReleasesHint', lang)}</span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label={t('changelogEvery', lang)}>
        <Input name="everyHours" type="number" min={1} max={168} defaultValue={current.everyHours} className="w-30" />
      </Field>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-body font-medium text-ink">{t('changelogTranslate', lang)}</div>
          <p className="mt-0.5 text-body-sm leading-snug text-ink-2">
            {t('changelogTranslateHint', lang)}
          </p>
        </div>
        <Switch checked={translate} onCheckedChange={setTranslate} />
      </div>

      <FormSaveBar lang={lang} />
    </form>
  )
}

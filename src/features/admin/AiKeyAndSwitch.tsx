'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Field } from '@/shared/ui/Field'
import { t, type Lang } from '@/shared/i18n'

export type AiProviderChoice = 'openrouter' | 'selectel' | 'yandex' | 'gigachat'

/** Провайдер ИИ + его ключи (маскированные) + переключатель генерации.
 *  Поля показываются под выбранный провайдер; полный ключ на клиент не приходит —
 *  только маска и флаг «задан». Пустое поле при сохранении = «не менять». */
export function AiKeyAndSwitch({
  enabled,
  provider,
  hasKey,
  maskedKeys,
  yandexFolder,
  searchKeyMasked,
  lang,
  onProviderChange,
}: {
  enabled: boolean
  provider: AiProviderChoice
  /** Есть ли сохранённый ключ у каждого провайдера (БД или env). */
  hasKey: Record<AiProviderChoice, boolean>
  /** Маска сохранённого ключа (пусто = не задан). */
  maskedKeys: Record<AiProviderChoice, string>
  /** Текущий folder_id Яндекса (БД или env) — он не секрет. */
  yandexFolder: string
  /** Маска ключа Yandex Search API (веб-гора); пусто = не задан. */
  searchKeyMasked: string
  lang: Lang
  /** Смена провайдера — родитель подтягивает каталог моделей ВЫБРАННОГО провайдера. */
  onProviderChange?: (provider: AiProviderChoice) => void
}) {
  const [prov, setProv] = useState<AiProviderChoice>(provider)
  const [keyInput, setKeyInput] = useState('')
  const [reveal, setReveal] = useState(false)
  const [on, setOn] = useState(enabled)

  const canEnable = hasKey[prov] || keyInput.trim().length > 0
  const checked = on && canEnable

  const inputCls =
    'w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[0.8125rem] text-ink outline-hidden focus:border-border-strong'

  const KEY_FIELD: Record<AiProviderChoice, { label: string; placeholder: string; name: string }> = {
    openrouter: { label: t('admin.openRouterApiKey', lang), placeholder: 'sk-or-v1-…', name: 'apiKey' },
    selectel: { label: t('admin.selectelAiRouterApi', lang), placeholder: 'sk-sl-v1-…', name: 'selectelKey' },
    yandex: { label: t('admin.yandexAiStudioApi', lang), placeholder: 'AQVN…', name: 'yandexKey' },
    gigachat: { label: t('admin.gigaChatAuthorizationKeyBasic', lang), placeholder: 'base64(ClientID:Secret)', name: 'gigachatKey' },
  }
  const field = KEY_FIELD[prov]

  const PROVIDER_NOTE: Record<AiProviderChoice, string> = {
    openrouter: t('admin.foreignAggregatorUserText', lang),
    selectel: t('admin.trafficGoesThroughSelectel', lang),
    yandex: t('admin.fullyRuYandexCloud', lang),
    gigachat: t('admin.fullyRuSberNeeds', lang),
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[0.875rem] font-medium text-ink">{t('admin.draftingEnabled', lang)}</div>
          <p className="text-[0.78125rem] text-muted">
            {canEnable
              ? t('admin.listsCanBeDrafted', lang)
              : t('admin.enterApiKeyBelow', lang)}
          </p>
        </div>
        <Switch name="enabled" checked={checked} onCheckedChange={setOn} disabled={!canEnable} />
      </div>

      <Field label={t('admin.provider', lang)} hint={PROVIDER_NOTE[prov]}>
        <Select
          name="provider"
          value={prov}
          onValueChange={(v) => {
            const next = v as AiProviderChoice
            setProv(next)
            setKeyInput('')
            onProviderChange?.(next)
          }}
        >
          <SelectTrigger className="text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openrouter">OpenRouter</SelectItem>
            <SelectItem value="selectel">{t('admin.selectelAiRouterRu', lang)}</SelectItem>
            <SelectItem value="yandex">YandexGPT / AI Studio (РФ)</SelectItem>
            <SelectItem value="gigachat">{t('admin.gigaChatSberRu', lang)}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {/* htmlFor: рядом с полем кнопка «показать» — оборачивание в label ловило бы её клики. */}
      <Field
        label={field.label}
        htmlFor="ai-api-key"
        hint={
          hasKey[prov]
            ? t('admin.keySavedShownMasked', lang)
            : t('admin.storedDbSetVia', lang)
        }
      >
        <div className="relative">
          <input
            key={prov} // смена провайдера сбрасывает поле, а не тащит чужой ключ
            id="ai-api-key"
            name={field.name}
            type={reveal ? 'text' : 'password'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={hasKey[prov] ? maskedKeys[prov] || '••••••••' : field.placeholder}
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} pr-10`}
          />
          <button
            type="button"
            aria-label={reveal ? 'hide' : 'show'}
            onClick={() => setReveal((v) => !v)}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink"
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </Field>

      {prov === 'yandex' && (
        <div>
          <Field
            label={t('admin.yandexCloudFolderId', lang)}
            hint={t('admin.fromConsoleUrlAistudio', lang)}
          >
            <input
              name="yandexFolder"
              defaultValue={yandexFolder}
              placeholder="b1g…"
              autoComplete="off"
              spellCheck={false}
              className={inputCls}
            />
          </Field>
          {/* Веб-гора: ОТДЕЛЬНЫЙ ключ Yandex Search API (не чат-ключ). Пусто →
              веб-разведчик совета молча пропускается, а не выдумывает прецеденты. */}
          <Field
            className="mt-4"
            label={t('admin.yandexSearchApiKey', lang)}
            hint={t('admin.separatePaidServiceActivate', lang)}
          >
            <input
              name="yandexSearchKey"
              defaultValue=""
              placeholder={searchKeyMasked || 'AQVN…'}
              autoComplete="off"
              spellCheck={false}
              className={inputCls}
            />
          </Field>
        </div>
      )}
    </div>
  )
}

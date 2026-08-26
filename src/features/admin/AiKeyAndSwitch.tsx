'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Field } from '@/shared/ui/Field'
import { t, type Lang } from '@/shared/i18n'
import { Input } from '@/shared/ui/input'
import { IconButton } from '@/shared/ui/IconButton'

export type AiProviderChoice = 'openrouter' | 'selectel' | 'yandex' | 'gigachat'
export type KeySource = 'db' | 'env' | 'none'

/** Radix Select не принимает пустую строку как значение — «нет запасного» несём явным словом,
 *  а серверный экшен превращает его обратно в пустоту. */
export const NO_FALLBACK = '__none__'

const PROVIDER_LABEL: Record<AiProviderChoice, string> = {
  openrouter: 'OpenRouter',
  selectel: 'Selectel',
  yandex: 'YandexGPT',
  gigachat: 'GigaChat',
}

/** Провайдер ИИ + его ключи (маскированные) + переключатель генерации.
 *  Поля показываются под выбранный провайдер; полный ключ на клиент не приходит —
 *  только маска и флаг «задан». Пустое поле при сохранении = «не менять». */
export function AiKeyAndSwitch({
  enabled,
  provider,
  hasKey,
  maskedKeys,
  keySources,
  fallbackProvider,
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
  /** Откуда ключ у каждого провайдера: база, env стенда или его нет. */
  keySources: Record<AiProviderChoice, KeySource>
  /** Запасной провайдер ('' = выключен). */
  fallbackProvider: string
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


  const KEY_FIELD: Record<AiProviderChoice, { label: string; placeholder: string; name: string }> = {
    openrouter: { label: t('admin.openRouterApiKey', lang), placeholder: 'sk-or-v1-…', name: 'apiKey' },
    selectel: { label: t('admin.selectelAiRouterApi', lang), placeholder: 'sk-sl-v1-…', name: 'selectelKey' },
    yandex: { label: t('admin.yandexAiStudioApi', lang), placeholder: 'AQVN…', name: 'yandexKey' },
    gigachat: { label: t('admin.gigaChatAuthorizationKeyBasic', lang), placeholder: 'base64(ClientID:Secret)', name: 'gigachatKey' },
  }
  const field = KEY_FIELD[prov]

  // ОТКУДА ключ — прямым текстом. «Ключ есть» с маской выглядит одинаково для базы и для env,
  // а ведут себя они по-разному: после сброса базы остаётся env, после передеплоя без env —
  // база. Отсюда и брались вопросы «ключ исчез, вводить заново?».
  const KEY_HINT: Record<KeySource, string> = {
    db: t('admin.keyFromDb', lang),
    env: t('admin.keyFromEnv', lang),
    none: t('admin.keyNotSet', lang),
  }

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
          <div className="text-body-lg font-medium text-ink">{t('admin.draftingEnabled', lang)}</div>
          <p className="text-body-sm text-muted">
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
          <SelectTrigger className="text-body">
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

      {/* ЗАПАСНОЙ — на случай, когда основной недоступен (лёг egress-мост, гео-блок, авария у
          провайдера). Выключен по умолчанию и задаётся руками СОЗНАТЕЛЬНО: молча уронить
          генерацию с RU-провайдера на зарубежный значит отправить пользовательский текст за
          границу без ведома владельца. */}
      <Field
        label={t('admin.spareProvider', lang)}
        hint={t('admin.spareProviderHint', lang)}
      >
        <Select name="fallbackProvider" defaultValue={fallbackProvider || NO_FALLBACK}>
          <SelectTrigger className="text-body">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_FALLBACK}>{t('admin.none', lang)}</SelectItem>
            {(['openrouter', 'selectel', 'yandex', 'gigachat'] as AiProviderChoice[])
              .filter((p) => p !== prov && hasKey[p])
              .map((p) => (
                <SelectItem key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>

      {/* htmlFor: рядом с полем кнопка «показать» — оборачивание в label ловило бы её клики. */}
      <Field
        label={field.label}
        htmlFor="ai-api-key"
        hint={KEY_HINT[keySources[prov]]}
      >
        <Input
          key={prov} // смена провайдера сбрасывает поле, а не тащит чужой ключ
          id="ai-api-key"
          name={field.name}
          type={reveal ? 'text' : 'password'}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={hasKey[prov] ? maskedKeys[prov] || '••••••••' : field.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          // Глаз показываем ТОЛЬКО когда есть что показывать — то есть когда ключ
          // набрали прямо сейчас. Сохранённый ключ в браузер не уезжает вовсе (на
          // месте плейсхолдера стоит маска), и переключать `type` у ПУСТОГО поля
          // бессмысленно: кнопка нажимается, а не показывает ничего (жалоба
          // владельца 13.08.2026).
          trailing={
            keyInput.length > 0 ? (
              <IconButton
                size="sm"
                variant="ghost"
                touch="hit"
                label={reveal ? t('admin.hideKey', lang) : t('admin.showKey', lang)}
                onClick={() => setReveal((v) => !v)}
              >
                {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
              </IconButton>
            ) : undefined
          }
        />
      </Field>

      {prov === 'yandex' && (
        <div>
          <Field
            label={t('admin.yandexCloudFolderId', lang)}
            hint={t('admin.fromConsoleUrlAistudio', lang)}
          >
            <Input name="yandexFolder" defaultValue={yandexFolder} placeholder="b1g…" autoComplete="off" spellCheck={false} className="font-mono" />
          </Field>
          {/* Веб-гора: ОТДЕЛЬНЫЙ ключ Yandex Search API (не чат-ключ). Пусто →
              веб-разведчик совета молча пропускается, а не выдумывает прецеденты. */}
          <Field
            className="mt-4"
            label={t('admin.yandexSearchApiKey', lang)}
            hint={t('admin.separatePaidServiceActivate', lang)}
          >
            <Input name="yandexSearchKey" defaultValue="" placeholder={searchKeyMasked || 'AQVN…'} autoComplete="off" spellCheck={false} className="font-mono" />
          </Field>
        </div>
      )}
    </div>
  )
}

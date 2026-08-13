'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, PlugZap, RefreshCw } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { Alert } from '@/shared/ui/Alert'
import { AiKeyAndSwitch, type AiProviderChoice } from './AiKeyAndSwitch'
import { ModelSelect, type Option } from './ModelSelect'
import { CreditsWidget } from './CreditsWidget'
import { checkProvider, loadProviderCatalog } from './model-catalog-action'
import { CUR_SIGN, type Currency } from './model-options'
import { catalogProblem } from './catalog-problem'
import { t, type Lang } from '@/shared/i18n'
import { cardClass } from '@/shared/ui/card-style'

/**
 * ПРОВАЙДЕР, ЕГО МОДЕЛИ И ЕГО ДЕНЬГИ — одним блоком, потому что это одна связка.
 *
 * Баг, ради которого блок и появился: каталог моделей рендерился сервером для СОХРАНЁННОГО
 * провайдера, а переключатель провайдера жил в клиентском состоянии. Выбор другого провайдера
 * не менял список, а сохранение записывало модель СТАРОГО провайдера в неймспейс НОВОГО —
 * настройка ломалась молча, и «ничего не происходит» было ровно этим.
 *
 * Тем же болели подпись про валюту цен и блок контроля расходов: они остались на сервере и
 * говорили «расход в ₽/день, контроль расходов Яндекса», когда в селекте уже стоял OpenRouter.
 * Поэтому они переехали сюда — всё, что зависит от ВЫБРАННОГО провайдера, живёт в одном месте
 * и обновляется одним запросом.
 *
 * И главное: селект моделей больше НИКОГДА не подменяется голым полем ввода. Пустой каталог —
 * это состояние («не загрузился, вот причина, вот кнопка повторить»), а не другой виджет:
 * подмена читалась как удалённая фича выбора моделей с ценами.
 */
export function AiProviderModels({
  provider,
  hasKey,
  maskedKeys,
  keySources,
  fallbackProvider,
  yandexFolder,
  searchKeyMasked,
  enabled,
  lang,
  initial,
  labels,
}: {
  provider: AiProviderChoice
  hasKey: Record<string, boolean>
  maskedKeys: Record<string, string>
  keySources: Record<string, 'db' | 'env' | 'none'>
  /** Запасной провайдер ('' = выключен) — прокидываем вниз, форма одна. */
  fallbackProvider: string
  yandexFolder: string
  searchKeyMasked: string
  enabled: boolean
  lang: Lang
  initial: {
    chat: Option[]
    embedding: Option[]
    chatModel: string
    fallbackModel: string
    embeddingModel: string
    cheapModeThreshold: number
    currency: Currency
    pricesKnown: boolean
    /** Каталог не приехал: 'no-key' | HTTP-код | сетевая ошибка. */
    error?: string
  }
  labels: { chat: string; fallback: string; embedding: string; embeddingHint: string; pick: string; loading: string; noKey: string }
}) {

  const [prov, setProv] = useState<AiProviderChoice>(provider)
  const [chat, setChat] = useState<Option[]>(initial.chat)
  const [embedding, setEmbedding] = useState<Option[]>(initial.embedding)
  const [values, setValues] = useState({
    chatModel: initial.chatModel,
    fallbackModel: initial.fallbackModel,
    cheapModeThreshold: initial.cheapModeThreshold,
  })
  const [currency, setCurrency] = useState<Currency>(initial.currency)
  const [pricesKnown, setPricesKnown] = useState(initial.pricesKnown)
  const [error, setError] = useState<string | undefined>(initial.error)
  const [pending, startTransition] = useTransition()
  // Результат явной проверки подключения: держим отдельно от каталога — это ответ на
  // вопрос «живо ли сейчас», а не состояние списка.
  const [checked, setChecked] = useState<{ ok: boolean; text: string } | null>(null)
  const [checking, setChecking] = useState(false)

  const reload = (next: AiProviderChoice) => {
    setProv(next)
    startTransition(async () => {
      // Опции приходят готовыми: цены и валюта у провайдеров разные, и форматировать их на
      // клиенте значило бы держать вторую копию правил.
      const cat = await loadProviderCatalog(next, lang)
      setChat(cat.chat)
      setEmbedding(cat.embedding)
      setValues({ chatModel: cat.saved.chatModel, fallbackModel: cat.saved.fallbackModel, cheapModeThreshold: cat.saved.cheapModeThreshold })
      setCurrency(cat.currency)
      setPricesKnown(cat.pricesKnown)
      setError(cat.error)
    })
  }

  const sign = CUR_SIGN[currency]
  const customHint = t('admin.use2', lang)
  // Каталога нет вообще — единственный способ задать модель это ввести id руками, и об
  // этом надо сказать прямо в поле поиска, а не подменять виджет.
  const emptyCatalog = chat.length === 0

  return (
    <>
      <AiKeyAndSwitch
        enabled={enabled}
        provider={provider}
        hasKey={hasKey}
        maskedKeys={maskedKeys}
        keySources={keySources as Record<AiProviderChoice, 'db' | 'env' | 'none'>}
        fallbackProvider={fallbackProvider}
        yandexFolder={yandexFolder}
        searchKeyMasked={searchKeyMasked}
        lang={lang}
        onProviderChange={reload}
      />

      {pending && (
        <p className="flex items-center gap-1.5 text-[0.78125rem] text-muted">
          <Loader2 size={13} className="animate-spin" /> {labels.loading}
        </p>
      )}

      {/* Ключ ВЫБРАННОГО провайдера. Раньше это предупреждение висело на странице СНАРУЖИ и
          считалось для СОХРАНЁННОГО провайдера — поэтому рядом с полным списком моделей
          могла гореть ошибка «провайдер не сконфигурирован»: они были про разных. */}
      {!pending && !hasKey[prov] && (
        <Alert variant="warn">
          {t('admin.providerNoKey', lang)}
        </Alert>
      )}

      {/* Состояние каталога словами + явная проверка подключения. Короткий список перестаёт
          читаться как поломка, а «живо ли сейчас» больше не надо выяснять переключением. */}
      {!pending && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {!error && hasKey[prov] && (
            <span className="min-w-0 flex-1 text-[0.78125rem] text-muted">
              {t('admin.catalogCounts', lang).replace('{chat}', String(chat.length)).replace('{emb}', String(embedding.length))}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              setChecking(true)
              setChecked(null)
              try {
                const r = await checkProvider(prov)
                setChecked({
                  ok: r.ok,
                  text: r.ok
                    ? t('admin.connectionAlive', lang).replace('{n}', String(r.chat))
                    : catalogProblem(r.error ?? 'unknown', lang),
                })
              } finally {
                setChecking(false)
              }
            }}
            disabled={checking}
            className="shrink-0 max-sm:ml-auto"
          >
            {checking ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
            {t('admin.checkConnection', lang)}
          </Button>
        </div>
      )}

      {checked && (
        <Alert variant={checked.ok ? 'ok' : 'warn'}>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {checked.ok && <CheckCircle2 size={13} className="mr-1 inline" />}
            {checked.text}
          </span>
        </Alert>
      )}

      {/* Причина всегда названа: молчаливый пустой список — это и есть «фичу откатили». */}
      {!pending && error && (
        <Alert variant="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {catalogProblem(error, lang)}
            </span>
            {/* max-sm:ml-auto — при переносе строки кнопка прижимается вправо, а не повисает по центру. */}
            <Button size="sm" onClick={() => reload(prov)} className="shrink-0 max-sm:ml-auto">
              <RefreshCw size={13} /> {t('admin.retry', lang)}
            </Button>
          </div>
        </Alert>
      )}

      {/* htmlFor/id — из фикса доступности (#571): подпись связана с кнопкой-триггером. */}
      <Field label={labels.chat} htmlFor="chatModel">
        {/* key по значению — при смене каталога селект пересоздаётся со свежим значением:
            иначе внутри остаётся выбранная модель ЧУЖОГО провайдера. */}
        <ModelSelect
          key={`chat-${values.chatModel}`}
          id="chatModel"
          name="chatModel"
          defaultValue={values.chatModel}
          options={chat}
          placeholder={emptyCatalog ? t('admin.typeModelId', lang) : labels.pick}
          allowCustom
          customHint={customHint}
          ru={lang === 'ru'}
        />
      </Field>

      <Field label={labels.fallback} htmlFor="fallbackModel">
        <ModelSelect
          key={`fb-${values.fallbackModel}`}
          id="fallbackModel"
          name="fallbackModel"
          defaultValue={values.fallbackModel}
          options={chat}
          allowEmpty
          placeholder="—"
          allowCustom
          customHint={customHint}
          ru={lang === 'ru'}
        />
      </Field>

      {/* Подпись говорит ширину колонки (из схемы), хинт — ИЗМЕРЕННЫЙ ответ выбранной модели. */}
      <Field label={labels.embedding} htmlFor="embeddingModel" hint={labels.embeddingHint}>
        <ModelSelect
          key={`emb-${prov}`}
          id="embeddingModel"
          name="embeddingModel"
          defaultValue={initial.embeddingModel}
          options={embedding}
          placeholder={embedding.length === 0 ? t('admin.typeModelId', lang) : labels.pick}
          allowCustom
          customHint={customHint}
          ru={lang === 'ru'}
        />
      </Field>

      <p className="text-[0.78125rem] text-muted">
        {pricesKnown
          ? t('admin.pricesPer1m', lang).replace('{s}', sign)
          : t('admin.thisProviderDoesNot', lang)}
      </p>

      {/* Порог живёт у провайдера, поэтому и подпись, и валюта — от ВЫБРАННОГО, а не сохранённого. */}
      {(prov === 'openrouter' || prov === 'yandex') && (
        <div className={cardClass({ tone: 'inset', pad: 'sm', className: 'space-y-3' })}>
          <div className="text-[0.8125rem] font-medium text-ink">
            {prov === 'openrouter' ? t('admin.openRouterCostControl', lang) : t('admin.yandexCostControl', lang)}
          </div>
          {prov === 'openrouter' && <CreditsWidget lang={lang} />}
          <Field
            label={
              prov === 'openrouter'
                ? t('admin.fallbackThresholdBalance', lang).replace('{s}', sign)
                : t('admin.fallbackThresholdDaily', lang).replace('{s}', sign)
            }
            hint={
              prov === 'openrouter'
                ? t('admin.whenBalanceDropsBelow', lang)
                : t('admin.balanceNotExposedBy', lang)
            }
          >
            <Input
              key={`threshold-${prov}`}
              type="number"
              name="cheapModeThreshold"
              step="any"
              min="0"
              defaultValue={values.cheapModeThreshold}
            />
          </Field>
        </div>
      )}
    </>
  )
}

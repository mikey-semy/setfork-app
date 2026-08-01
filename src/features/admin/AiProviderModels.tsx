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
  ru,
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
  ru: boolean
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
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)

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
      const cat = await loadProviderCatalog(next, ru ? 'ru' : 'en')
      setChat(cat.chat)
      setEmbedding(cat.embedding)
      setValues({ chatModel: cat.saved.chatModel, fallbackModel: cat.saved.fallbackModel, cheapModeThreshold: cat.saved.cheapModeThreshold })
      setCurrency(cat.currency)
      setPricesKnown(cat.pricesKnown)
      setError(cat.error)
    })
  }

  const sign = CUR_SIGN[currency]
  const customHint = say('Use', 'Использовать')
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
        ru={ru}
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
          {say(
            'This provider has no key — generation and the model catalog are unavailable until you enter one.',
            'У этого провайдера нет ключа — генерация и каталог моделей недоступны, пока он не введён.',
          )}
        </Alert>
      )}

      {/* Состояние каталога словами + явная проверка подключения. Короткий список перестаёт
          читаться как поломка, а «живо ли сейчас» больше не надо выяснять переключением. */}
      {!pending && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {!error && hasKey[prov] && (
            <span className="min-w-0 flex-1 text-[0.78125rem] text-muted">
              {say(`Catalog: ${chat.length} chat models, ${embedding.length} embedding models.`, `Каталог: ${chat.length} моделей чата, ${embedding.length} эмбеддингов.`)}
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
                    ? say(`Connection is alive: ${r.chat} models.`, `Связь есть: ${r.chat} моделей.`)
                    : catalogProblem(r.error ?? 'unknown', say),
                })
              } finally {
                setChecking(false)
              }
            }}
            disabled={checking}
            className="min-h-11 shrink-0 max-sm:ml-auto"
          >
            {checking ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
            {say('Check', 'Проверить')}
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
              {catalogProblem(error, say)}
            </span>
            {/* max-sm:ml-auto — при переносе строки кнопка прижимается вправо, а не повисает по центру. */}
            <Button size="sm" onClick={() => reload(prov)} className="min-h-11 shrink-0 max-sm:ml-auto">
              <RefreshCw size={13} /> {say('Retry', 'Повторить')}
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
          placeholder={emptyCatalog ? say('Type the model id', 'Введите id модели') : labels.pick}
          allowCustom
          customHint={customHint}
          ru={ru}
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
          ru={ru}
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
          placeholder={embedding.length === 0 ? say('Type the model id', 'Введите id модели') : labels.pick}
          allowCustom
          customHint={customHint}
          ru={ru}
        />
      </Field>

      <p className="text-[0.78125rem] text-muted">
        {pricesKnown
          ? say(
              `Prices are per 1M tokens (prompt/completion), in ${sign}. Colour is relative to THIS catalog: green = its cheapest third, red = its priciest.`,
              `Цены в списках — за 1М токенов (prompt/completion), в ${sign}. Цвет — относительно ЭТОГО каталога: зелёные — дешёвая треть, красные — дорогая.`,
            )
          : say(
              'This provider does not expose prices via API — check the provider console.',
              'Провайдер не отдаёт цены по API — смотри тарифы в консоли провайдера.',
            )}
      </p>

      {/* Порог живёт у провайдера, поэтому и подпись, и валюта — от ВЫБРАННОГО, а не сохранённого. */}
      {(prov === 'openrouter' || prov === 'yandex') && (
        <div className="space-y-3 rounded-md border border-border bg-surface-2 p-3">
          <div className="text-[0.8125rem] font-medium text-ink">
            {prov === 'openrouter' ? say('OpenRouter cost control', 'Контроль расходов OpenRouter') : say('Yandex cost control', 'Контроль расходов Яндекса')}
          </div>
          {prov === 'openrouter' && <CreditsWidget ru={ru} />}
          <Field
            label={
              prov === 'openrouter'
                ? say(`Auto-fallback threshold (balance, ${sign})`, `Порог авто-fallback (остаток, ${sign})`)
                : say(`Auto-fallback threshold (${sign} per day)`, `Порог авто-fallback (расход, ${sign}/день)`)
            }
            hint={
              prov === 'openrouter'
                ? say(
                    'When the balance drops below this, generation switches to the fallback model. 0 = off.',
                    'Когда остаток упадёт ниже этой суммы — генерация переключится на запасную модель. 0 — выключено.',
                  )
                : say(
                    'Balance is not exposed by the API, so the threshold is DAILY spend (our journal, the stand price book): above it generation switches to the fallback model. 0 = off.',
                    'Баланс в API Яндекс не отдаёт, поэтому порог — ДНЕВНОЙ расход (наш журнал по прайс-книге стенда): выше него генерация переключается на запасную модель. 0 — выключено.',
                  )
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

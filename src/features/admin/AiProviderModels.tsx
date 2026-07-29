'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { AiKeyAndSwitch, type AiProviderChoice } from './AiKeyAndSwitch'
import { ModelSelect, type Option } from './ModelSelect'
import { loadProviderCatalog } from './model-catalog-action'

/**
 * ПРОВАЙДЕР И ЕГО МОДЕЛИ — одним блоком, потому что это одна связка.
 *
 * Баг, ради которого блок и появился: каталог моделей рендерился сервером для СОХРАНЁННОГО
 * провайдера, а переключатель провайдера жил в клиентском состоянии. Выбор другого провайдера
 * не менял список, а сохранение записывало модель СТАРОГО провайдера в неймспейс НОВОГО —
 * настройка ломалась молча, и «ничего не происходит» было ровно этим.
 *
 * Теперь смена провайдера сразу подтягивает его каталог и его СОХРАНЁННЫЕ модели: у каждого
 * провайдера свои настройки, переключение не тащит чужие и не теряет свои.
 */
export function AiProviderModels({
  provider,
  hasKey,
  maskedKeys,
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
  yandexFolder: string
  searchKeyMasked: string
  enabled: boolean
  ru: boolean
  initial: { chat: Option[]; embedding: Option[]; chatModel: string; fallbackModel: string; embeddingModel: string }
  labels: { chat: string; fallback: string; embedding: string; pick: string; loading: string; noKey: string }
}) {
  const [chat, setChat] = useState<Option[]>(initial.chat)
  const [embedding, setEmbedding] = useState<Option[]>(initial.embedding)
  const [values, setValues] = useState({ chatModel: initial.chatModel, fallbackModel: initial.fallbackModel })
  const [configured, setConfigured] = useState(true)
  const [pending, startTransition] = useTransition()

  const onProviderChange = (next: AiProviderChoice) => {
    startTransition(async () => {
      // Опции приходят готовыми: цены и валюта у провайдеров разные, и форматировать их на
      // клиенте значило бы держать вторую копию правил.
      const cat = await loadProviderCatalog(next, ru ? 'ru' : 'en')
      setChat(cat.chat)
      setEmbedding(cat.embedding)
      setValues({ chatModel: cat.saved.chatModel, fallbackModel: cat.saved.fallbackModel })
      setConfigured(cat.configured)
    })
  }

  const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-hidden'
  const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

  return (
    <>
      <AiKeyAndSwitch
        enabled={enabled}
        provider={provider}
        hasKey={hasKey}
        maskedKeys={maskedKeys}
        yandexFolder={yandexFolder}
        searchKeyMasked={searchKeyMasked}
        ru={ru}
        onProviderChange={onProviderChange}
      />

      {pending && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <Loader2 size={13} className="animate-spin" /> {labels.loading}
        </p>
      )}
      {!configured && !pending && <p className="text-[12.5px] text-warn">{labels.noKey}</p>}

      <div>
        <label className={lbl} htmlFor="chatModel">{labels.chat}</label>
        {/* key={провайдер+длина} — при смене каталога селект пересоздаётся со свежим значением:
            иначе внутри остаётся выбранная модель ЧУЖОГО провайдера. */}
        {chat.length > 0 ? (
          <ModelSelect key={`chat-${chat.length}-${values.chatModel}`} id="chatModel" name="chatModel" defaultValue={values.chatModel} options={chat} placeholder={labels.pick} />
        ) : (
          <input key={`chat-input-${values.chatModel}`} id="chatModel" name="chatModel" defaultValue={values.chatModel} className={`${field} font-mono`} />
        )}
      </div>

      <div>
        <label className={lbl} htmlFor="fallbackModel">{labels.fallback}</label>
        {chat.length > 0 ? (
          <ModelSelect key={`fb-${chat.length}-${values.fallbackModel}`} id="fallbackModel" name="fallbackModel" defaultValue={values.fallbackModel} options={chat} allowEmpty placeholder="—" />
        ) : (
          <input key={`fb-input-${values.fallbackModel}`} id="fallbackModel" name="fallbackModel" defaultValue={values.fallbackModel} className={`${field} font-mono`} />
        )}
      </div>

      <div>
        <label className={lbl} htmlFor="embeddingModel">{labels.embedding}</label>
        {embedding.length > 0 ? (
          <ModelSelect id="embeddingModel" name="embeddingModel" defaultValue={initial.embeddingModel} options={embedding} placeholder={labels.pick} />
        ) : (
          <input id="embeddingModel" name="embeddingModel" defaultValue={initial.embeddingModel} className={`${field} font-mono`} />
        )}
      </div>
    </>
  )
}

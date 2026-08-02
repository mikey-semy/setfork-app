'use server'
import { requireAdmin } from '@/shared/auth/admin'
import { fetchModelsFor } from '@/shared/ai/models'
import { buildOpts, withSavedOption } from './model-options'
import { modelMeta } from './model-enrich'
import type { Option } from './ModelSelect'
import type { Lang } from '@/shared/i18n'
import { AI_PROVIDERS, getModelSettings, type AiProviderId } from '@/shared/settings/ai'

/**
 * КАТАЛОГ МОДЕЛЕЙ ВЫБРАННОГО ПРОВАЙДЕРА — для админки, до сохранения настроек.
 *
 * Баг, который это чинит: список моделей рендерился сервером для СОХРАНЁННОГО провайдера, а
 * переключатель провайдера — клиентское состояние. Поэтому выбор другого провайдера ничего не
 * менял в списке, и при сохранении в неймспейс нового провайдера уезжала модель СТАРОГО
 * (например `gpt://…/yandexgpt-5.1` попадал в openrouter) — то есть настройка молча ломалась.
 *
 * Возвращаем ещё и уже сохранённые модели этого провайдера: у каждого провайдера свои
 * настройки, и переключение не должно ни терять их, ни тащить чужие.
 */
export interface ProviderCatalog {
  provider: AiProviderId
  chat: Option[]
  embedding: Option[]
  currency: 'USD' | 'RUB'
  pricesKnown: boolean
  /** Ключа нет — каталог недоступен, id вводится руками. */
  configured: boolean
  /** Каталог не приехал: 'no-key' | HTTP-код | сетевая ошибка. Пусто = всё в порядке. */
  error?: string
  saved: { chatModel: string; fallbackModel: string; cheapModeThreshold: number }
}

export async function loadProviderCatalog(providerRaw: string, lang: Lang = 'ru'): Promise<ProviderCatalog> {
  await requireAdmin()
  const provider = ((AI_PROVIDERS as readonly string[]).includes(providerRaw) ? providerRaw : 'openrouter') as AiProviderId
  const [models, saved] = await Promise.all([fetchModelsFor(provider), getModelSettings(provider)])
  // Наш опыт считается по журналу целиком (он не привязан к провайдеру): при смене провайдера
  // строки о моделях, которые мы уже звали, обязаны остаться — иначе выбор снова вслепую.
  const meta = await modelMeta(models.currency, lang === 'ru')
  return {
    provider,
    // Опции строит СЕРВЕР той же функцией, что и страница: у провайдеров разная валюта и
    // разные пороги «дёшево/дорого», и вторая копия правил формата разъехалась бы.
    chat: withSavedOption(buildOpts(models.chat, false, lang, models.currency, models.pricesKnown, meta), saved.chatModel),
    embedding: buildOpts(models.embedding, true, lang, models.currency, models.pricesKnown, meta),
    currency: models.currency,
    pricesKnown: models.pricesKnown,
    configured: models.configured,
    error: models.error,
    saved: { chatModel: saved.chatModel, fallbackModel: saved.fallbackModel, cheapModeThreshold: saved.cheapModeThreshold },
  }
}

/**
 * ПРОВЕРИТЬ ПОДКЛЮЧЕНИЕ — отдельным действием, а не побочно при переключении провайдера.
 *
 * До этого единственный способ узнать «а живо ли вообще» был косвенный: переключить провайдера
 * и посмотреть, приехал ли список. Владелец при недоступном провайдере видел короткий список и
 * читал его как поломку выбора моделей — вопрос «ключ есть или нет?» рождался именно здесь.
 * Кеш каталога сбрасываем: проверка обязана спрашивать провайдера заново, иначе она подтвердит
 * прошлый ответ вместо нынешнего.
 */
export async function checkProvider(providerRaw: string): Promise<{ ok: boolean; chat: number; embedding: number; error?: string }> {
  await requireAdmin()
  const provider = ((AI_PROVIDERS as readonly string[]).includes(providerRaw) ? providerRaw : 'openrouter') as AiProviderId
  const { clearModelCatalogCache } = await import('@/shared/ai/models')
  clearModelCatalogCache()
  const r = await fetchModelsFor(provider)
  return { ok: !r.error && r.chat.length > 0, chat: r.chat.length, embedding: r.embedding.length, error: r.error }
}

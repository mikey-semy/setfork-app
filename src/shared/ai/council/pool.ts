import type { AiProviderId, AiSettings } from '@/shared/settings/ai'
import { modelAllowed, parseModelAllowlist } from '@/shared/settings/ai'
import { fetchModelsFor } from '../models'
import { deriveCouncilPool } from '../model-picker'
import { baseModelId, filterByQuarantine, quarantinedModels } from '../health'
import { envNumber } from '@/shared/env'

/**
 * Какими моделями работает совет: пул, быстрая модель для промежуточных шагов и
 * проверка «этой моделью вообще можно».
 *
 * Отдельно от оркестрации, потому что причин меняться здесь свои и они частые:
 * новый провайдер со своим форматом id, каталог моделей, белый список, карантин по
 * просевшему success-rate. Раньше всё это стояло сорока строками посреди функции,
 * между «получили настройки» и «позвали гномов».
 */
// Дефолтного пула СПИСКОМ нет намеренно: по одному на провайдера они устаревали молча
// (модель снимают с обслуживания, и совет получает 404 при исправном ключе). Пул выводится
// из живого каталога одним правилом для всех: самые дешёвые рабочие лошадки, первая —
// самая дешёвая, она и ведёт промежуточные шаги (model-picker.deriveCouncilPool).
const COUNCIL_POOL_SIZE = envNumber('SETFORK_COUNCIL_POOL_SIZE', 3)

export type CouncilPool = {
  /** Модели совета: сколько собралось, столько и есть; пустой пул откатывается на базовую. */
  pool: string[]
  /** Быстрая модель для промежуточных шагов (классификация, критика, веб). */
  fast: string
  /** Можно ли звать эту модель прямо сейчас: провайдер + белый список + не в карантине. */
  usable: (m: string) => boolean
}

/** Формат id у провайдеров разный: у Яндекса строго `gpt://…`, у GigaChat без слешей. */
const providerFilter = (provider: AiProviderId) => (m: string) => {
  if (provider === 'yandex') return m.startsWith('gpt://')
  if (provider === 'gigachat') return !m.includes('/') // чужие — vendor/model или gpt://
  return true
}

/** Жёсткий отбор: провайдер и белый список обходить нельзя, ради этого список и заводят. */
export function buildCouncilPool(rawPool: string[], permitted: (m: string) => boolean, quarantined: ReadonlySet<string>, base: string): string[] {
  const hard = rawPool.filter(permitted)
  return hard.length ? filterByQuarantine(hard, quarantined) : [base]
}

export async function resolveCouncilPool(provider: AiProviderId, settings: AiSettings, base: string): Promise<CouncilPool> {
  const forProvider = providerFilter(provider)

  // Пул по умолчанию — из каталога АКТИВНОГО провайдера (каталог кеширован, сети на
  // каждый совет нет). Каталог недоступен → пустой список, и сборка честно откатится
  // на базовую модель: лучше одномодельный совет, чем вызовы к снятым с обслуживания id.
  const catalog = (await fetchModelsFor(provider)).chat
  const defaultPool = deriveCouncilPool(catalog, COUNCIL_POOL_SIZE)

  // Ручной пул тоже сверяем с каталогом: у одиночной модели такая сверка есть (liveModel),
  // а здесь снятая с обслуживания модель обнаруживалась только после нескольких отказов
  // подряд. Каталог пуст (сеть/ключ) — не трогаем выбор владельца.
  // Множество вместо перебора: каталог до 336 моделей, и `includes` в цикле сканирует
  // его целиком на каждую строку пула.
  const catalogIds = new Set(catalog.map((c) => c.id))
  const listed = settings.councilModels.filter((m) => !catalogIds.size || catalogIds.has(m))
  if (catalogIds.size && listed.length < settings.councilModels.length) {
    const kept = new Set(listed)
    const gone = settings.councilModels.filter((m) => !kept.has(m))
    console.warn(`[council] моделей нет в каталоге ${provider}, исключены из пула: ${gone.join(', ')}`)
  }

  // АВТОРОТАЦИЯ: модели с проседающим success-rate за сутки (журнал ai_usage) временно
  // выпадают из ротации; окно скользящее — возврат автоматический.
  const quarantined = await quarantinedModels()
  const allowlist = parseModelAllowlist()
  const permitted = (m: string) => forProvider(m) && modelAllowed(m, allowlist)

  const pool = buildCouncilPool(listed.length ? listed : defaultPool, permitted, quarantined, base)
  return {
    pool,
    // Быстрая модель для ПРОМЕЖУТОЧНЫХ шагов: reasoning-модель там не нужна, а совет из
    // шести-семи вызовов на ней тормозит минутами. Финал считается на базовой.
    fast: pool[0] || base,
    usable: (m: string) => permitted(m) && !quarantined.has(baseModelId(m)),
  }
}

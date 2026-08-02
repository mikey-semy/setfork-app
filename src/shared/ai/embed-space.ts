import 'server-only'
import { getSettings, saveSettings } from '@/shared/settings/kv'
import { embeddings } from '@/shared/db'
import { defaultEmbeddingModel } from '@/shared/settings/ai'

// «Пространство» эмбеддингов = провайдер + модели (doc/query) + мерность.
// Источник правды — то, В ЧЁМ ПОСТРОЕН ИНДЕКС (embed.index_space, пишется при
// старте полного реиндекса): и вставки, и поисковые запросы обязаны идти одним
// пространством, иначе близость — мусор. Цель (embed.provider) меняется в
// админке и вступает в силу ТОЛЬКО через полный реиндекс.
//
// Мерность колонки задана СХЕМОЙ (halfvec, P4 анализа поиска) и читается из неё же.
// У всех провайдеров просим ровно её (параметр dimensions). Что модель на это ответит —
// ФАКТ, который мы измеряем и запоминаем (embed-capability), а не угадываем по имени
// вендора: вернула столько же — идеально; вернула больше — усечение + L2-нормализация
// (осознанная деградация, о ней говорим вслух); меньше — паддинг нулями (косинус точен).

export type EmbedProvider = 'openrouter' | 'yandex'

/**
 * Мерность колонки — ЧИТАЕТСЯ ИЗ СХЕМЫ, а не повторяется числом. Пока это была отдельная
 * константа, она разъехалась со схемой (в каталоге моделей жило 1536 при колонке 768) и
 * подпись поля в админке говорила владельцу неправду. Схема — единственный источник.
 */
// Тип PgColumn мерность не раскрывает (она в конфиге колонки), поэтому доступ узко
// типизирован здесь — один раз и с проверкой. Это по-прежнему ЧТЕНИЕ СХЕМЫ: поменяли
// halfvec в schema.ts — поменялось всё, что ниже, без правок в других файлах.
const columnDimensions = (embeddings.embedding as unknown as { dimensions?: number }).dimensions
if (!columnDimensions) throw new Error('embeddings.embedding: не удалось прочитать мерность колонки из схемы')
export const COLUMN_DIM: number = columnDimensions

export interface EmbedSpace {
  provider: EmbedProvider
  docModel: string
  queryModel: string
  /** РОДНАЯ мерность пространства (в колонке 1536 паддинг нулями). */
  dim: number
  /** Момент старта реиндекса, unix ms (нет у legacy-пространства). */
  at?: number
}

export const EMBED_TARGET_SETTING = 'embed.provider'
export const EMBED_SPACE_SETTING = 'embed.index_space'

/** Чистый резолв ЦЕЛЕВОГО пространства (юнит-тестируется). */
export function resolveTargetSpace(
  m: Record<string, string | undefined>,
  env: Record<string, string | undefined> = process.env,
): EmbedSpace {
  const target = (m[EMBED_TARGET_SETTING]?.trim() || env.EMBED_PROVIDER || 'openrouter') as EmbedProvider
  if (target === 'yandex') {
    const folder = (m['ai.yandex_folder_id']?.trim() || env.YC_AI_FOLDER_ID || '').trim()
    return {
      provider: 'yandex',
      // Пара doc/query — у Яндекса это РАЗНЫЕ модели одного пространства.
      docModel: `emb://${folder}/text-embeddings-v2-doc/latest`,
      queryModel: `emb://${folder}/text-embeddings-v2-query/latest`,
      // Просим мерность колонки у ЛЮБОГО провайдера — своей цифры на провайдера больше нет.
      dim: COLUMN_DIM,
    }
  }
  const model = m['ai.embedding_model']?.trim() || defaultEmbeddingModel()
  return { provider: 'openrouter', docModel: model, queryModel: model, dim: COLUMN_DIM }
}

/** Разбор сохранённого embed.index_space; null = легаси (индекс до этой фичи). */
export function parseIndexSpace(raw: string | undefined | null): EmbedSpace | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as Partial<EmbedSpace>
    if ((j.provider === 'openrouter' || j.provider === 'yandex') && j.docModel && j.queryModel && j.dim) {
      return { provider: j.provider, docModel: j.docModel, queryModel: j.queryModel, dim: Number(j.dim), at: j.at }
    }
  } catch {
    /* битый JSON = легаси */
  }
  return null
}

const SPACE_KEYS = [EMBED_TARGET_SETTING, EMBED_SPACE_SETTING, 'ai.embedding_model', 'ai.yandex_folder_id']

async function readSpaceSettings(): Promise<Record<string, string>> {
  return getSettings(SPACE_KEYS)
}

let cache: { at: number; space: EmbedSpace } | null = null
const CACHE_TTL_MS = 60_000

/** Пространство, в котором ПОСТРОЕН индекс (для вставок и запросов). */
export async function getIndexSpace(): Promise<EmbedSpace> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.space
  const m = await readSpaceSettings()
  // Легаси (index_space ещё не писали): индекс строился OpenRouter'ом.
  const space =
    parseIndexSpace(m[EMBED_SPACE_SETTING]) ??
    ({ provider: 'openrouter', docModel: m['ai.embedding_model']?.trim() || defaultEmbeddingModel(), queryModel: m['ai.embedding_model']?.trim() || defaultEmbeddingModel(), dim: COLUMN_DIM } satisfies EmbedSpace)
  cache = { at: Date.now(), space }
  return space
}

/** Целевое пространство (что выбрано в админке; реиндекс переводит индекс в него). */
export async function getTargetSpace(): Promise<EmbedSpace> {
  return resolveTargetSpace(await readSpaceSettings())
}

/** Зафиксировать пространство индекса (вызывается при СТАРТЕ полного реиндекса). */
export async function setIndexSpace(space: EmbedSpace): Promise<void> {
  await saveSettings({ [EMBED_SPACE_SETTING]: JSON.stringify({ ...space, at: Date.now() }) })
  cache = null
}

export function clearEmbedSpaceCache(): void {
  cache = null
}

/** Привести вектор к мерности колонки: короче — паддинг нулями (косинус точен);
 *  длиннее — усечение + L2-нормализация (штатно для MRL; для прочих — деградация). */
let warnedTruncate = false
export function fitToColumn(vec: number[]): number[] {
  if (vec.length === COLUMN_DIM) return vec
  if (vec.length < COLUMN_DIM) return [...vec, ...new Array<number>(COLUMN_DIM - vec.length).fill(0)]
  if (!warnedTruncate) {
    warnedTruncate = true
    console.warn(`[embed-space] truncating ${vec.length}-dim vector to ${COLUMN_DIM} (use a dimensions-capable model)`)
  }
  const cut = vec.slice(0, COLUMN_DIM)
  const norm = Math.sqrt(cut.reduce((s, x) => s + x * x, 0)) || 1
  return cut.map((x) => x / norm)
}

/** Совпадает ли индекс с целью (нет — в админке горит «нужен реиндекс»). */
export function sameSpace(a: EmbedSpace, b: EmbedSpace): boolean {
  return a.provider === b.provider && a.docModel === b.docModel && a.dim === b.dim
}

export async function ensureFreshSpace(): Promise<{ index: EmbedSpace; target: EmbedSpace; inSync: boolean }> {
  const m = await readSpaceSettings()
  const index =
    parseIndexSpace(m[EMBED_SPACE_SETTING]) ??
    resolveTargetSpace({ ...m, [EMBED_TARGET_SETTING]: 'openrouter' })
  const target = resolveTargetSpace(m)
  return { index, target, inSync: sameSpace(index, target) }
}

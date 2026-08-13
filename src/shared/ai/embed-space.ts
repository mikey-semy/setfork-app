import 'server-only'
import { getSettings, saveSettings } from '@/shared/settings/kv'
import { EMBEDDING_COLUMN_DIM } from '@/shared/db/schema'
import { defaultEmbeddingModel } from '@/shared/settings/ai'

// «Пространство» эмбеддингов = провайдер + модели (doc/query) + мерность.
// Источник правды — то, В ЧЁМ ПОСТРОЕН ИНДЕКС (embed.index_space, пишется при
// старте полного реиндекса): и вставки, и поисковые запросы обязаны идти одним
// пространством, иначе близость — мусор. Цель (embed.provider) меняется в
// админке и вступает в силу ТОЛЬКО через полный реиндекс.
//
// МЕРНОСТЬ — СВОЙСТВО МОДЕЛИ, а не колонки: у OpenRouter/text-embedding-3-small она
// 1536, у Яндекс v2 — 768, и каждая работает в своей. Колонка — лишь потолок: вектор
// уже её ложится с паддингом нулями (косинус точен), шире — у модели просят срез
// (MRL, штатный параметр dimensions). Родную мерность мы ИЗМЕРЯЕМ и запоминаем
// (embed-capability), а не угадываем по имени вендора.
//
// Так было до разворота на РФ; на РФ потолок ужали до 768 под Яндекс — и все,
// включая OpenRouter, стали получать 768-мерный срез. Прод вернулся на .com —
// вернулось и правило «мерность от модели».

/** Провайдеры эмбеддингов — ОДИН список: из него и тип, и проверка чужого ввода, и набор
 *  пунктов в админке. Пара 'openrouter' | 'yandex' была переписана руками в разборе
 *  настройки, в server action и в разметке панели — новый провайдер требовал найти все три. */
export const EMBED_PROVIDERS = ['openrouter', 'yandex'] as const

export type EmbedProvider = (typeof EMBED_PROVIDERS)[number]

export function isEmbedProvider(v: unknown): v is EmbedProvider {
  return typeof v === 'string' && (EMBED_PROVIDERS as readonly string[]).includes(v)
}

/**
 * ПОТОЛОК колонки — из схемы (одна константа на halfvec и на весь код), а не число,
 * повторённое рядом с запросом. Пока оно жило отдельно, оно разъехалось со схемой: в
 * каталоге моделей стояло 1536 при колонке 768, и админка говорила владельцу неправду.
 */
export const COLUMN_DIM: number = EMBEDDING_COLUMN_DIM

export interface EmbedSpace {
  provider: EmbedProvider
  docModel: string
  queryModel: string
  /** Мерность пространства = родная мерность модели, ограниченная потолком колонки. */
  dim: number
  /** Момент старта реиндекса, unix ms (нет у legacy-пространства). */
  at?: number
}

/**
 * Мерность пространства по ИЗМЕРЕННОЙ родной мерности модели: сколько модель отдаёт,
 * столько и берём — но не шире колонки (шире — просим у модели срез).
 *
 * Не измерили — считаем, что модель заполняет колонку целиком: для дефолтной
 * text-embedding-3-small это ровно так, а первый же вызов запишет факт.
 */
export function spaceDim(nativeDim?: number | null): number {
  return nativeDim && nativeDim > 0 ? Math.min(nativeDim, COLUMN_DIM) : COLUMN_DIM
}

export const EMBED_TARGET_SETTING = 'embed.provider'
export const EMBED_SPACE_SETTING = 'embed.index_space'

/** Чистый резолв ЦЕЛЕВОГО пространства (юнит-тестируется).
 *  nativeDim — измеренная родная мерность выбранной модели (embed-capability); её
 *  добывает вызывающий, чтобы функция осталась чистой и не ходила ни в БД, ни в сеть. */
export function resolveTargetSpace(
  m: Record<string, string | undefined>,
  env: Record<string, string | undefined> = process.env,
  nativeDim?: number | null,
): EmbedSpace {
  // Настройка и env — чужой ввод: неизвестное значение падает на openrouter, а не
  // просачивается в EmbedSpace.provider под видом типа (раньше здесь стоял голый as).
  const raw = m[EMBED_TARGET_SETTING]?.trim() || env.EMBED_PROVIDER || ''
  const target: EmbedProvider = isEmbedProvider(raw) ? raw : 'openrouter'
  if (target === 'yandex') {
    const folder = (m['ai.yandex_folder_id']?.trim() || env.YC_AI_FOLDER_ID || '').trim()
    return {
      provider: 'yandex',
      // Пара doc/query — у Яндекса это РАЗНЫЕ модели одного пространства.
      docModel: `emb://${folder}/text-embeddings-v2-doc/latest`,
      queryModel: `emb://${folder}/text-embeddings-v2-query/latest`,
      dim: spaceDim(nativeDim),
    }
  }
  const model = m['ai.embedding_model']?.trim() || defaultEmbeddingModel()
  return { provider: 'openrouter', docModel: model, queryModel: model, dim: spaceDim(nativeDim) }
}

/** Разбор сохранённого embed.index_space; null = легаси (индекс до этой фичи). */
export function parseIndexSpace(raw: string | undefined | null): EmbedSpace | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as Partial<EmbedSpace>
    if (isEmbedProvider(j.provider) && j.docModel && j.queryModel && j.dim) {
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

/**
 * Родная мерность выбранной модели. `measure: true` разрешает короткую пробу у провайдера
 * (доли цента), `false` — только то, что уже измерено.
 *
 * Пробу зовёт не всякий читатель: панель админки опрашивает пространство раз в 1.5 с, и
 * проба оттуда молотила бы в провайдера на каждом тике. Меряем там, где решение принимается:
 * при сохранении модели и при старте реиндекса.
 *
 * Импорт динамический: embed-capability берёт отсюда COLUMN_DIM — статическая пара дала бы цикл.
 */
async function nativeDimOf(space: EmbedSpace, measure: boolean): Promise<number | null> {
  const { ensureCapability, getCapability } = await import('./embed-capability')
  const cap = measure
    ? await ensureCapability(space.provider, space.docModel)
    : await getCapability(space.provider, space.docModel)
  return cap?.dim ?? null
}

/** Целевое пространство (что выбрано в админке; реиндекс переводит индекс в него).
 *  Меряет модель пробой, если факта ещё нет. */
export async function getTargetSpace(): Promise<EmbedSpace> {
  const m = await readSpaceSettings()
  const base = resolveTargetSpace(m)
  return resolveTargetSpace(m, process.env, await nativeDimOf(base, true))
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

/**
 * Индекс, цель и сходятся ли они.
 *
 * `measure` = мерить ли модель пробой у провайдера: реиндекс — да (он фиксирует
 * пространство и обязан знать настоящую мерность), опрос панели — нет.
 * `targetMeasured` = мерность цели известна фактом, а не взята потолком колонки;
 * панель на этом говорит «не измерено» вместо красивого, но выдуманного числа.
 */
export async function ensureFreshSpace(
  measure = false,
): Promise<{ index: EmbedSpace; target: EmbedSpace; inSync: boolean; targetMeasured: boolean }> {
  const m = await readSpaceSettings()
  const index =
    parseIndexSpace(m[EMBED_SPACE_SETTING]) ??
    resolveTargetSpace({ ...m, [EMBED_TARGET_SETTING]: 'openrouter' })
  const native = await nativeDimOf(resolveTargetSpace(m), measure)
  const target = resolveTargetSpace(m, process.env, native)
  return { index, target, inSync: sameSpace(index, target), targetMeasured: native !== null }
}

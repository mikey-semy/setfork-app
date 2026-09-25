import 'server-only'
import { getSettings, saveSettings } from './kv'
import { LANDING_KEYS, LANDING_MAX_STATS, STAT_MAX, landingMaxLength, type LandingKey } from '@/shared/landing-keys'

/**
 * ПРАВКИ ЛЕНДИНГА ИЗ АДМИНКИ — И ТОЛЬКО ОНИ.
 *
 * Лендинг (setfork-about) тянет `GET /api/landing` и кладёт каждую строку из `content[lang]`
 * ПОВЕРХ своего словаря (`src/copy.ts`). Поэтому отсюда уходит ровно то, что человек
 * сохранил в админке, а не «умолчания»: тексты по умолчанию — это словарь самого лендинга.
 *
 * ⚠️ Здесь жили `LANDING_DEFAULTS` — копия словаря СТАРОГО лендинга, — и `/api/landing`
 * отдавал их целиком, как будто это правки. Новый лендинг получил бы поверх своих текстов
 * «Lists that get», «GitHub for lists» и старые призывы, хотя в админке никто ничего не
 * сохранял (строки `landing.content` на проде 25.09 не было вовсе).
 *
 * Хранится одним JSON-ключом в `app_settings`: `{ en: {…}, ru: {…} }`, где у языка —
 * строковые ключи словаря и `stats`. Всё незнакомое при чтении отсеивается: старый формат
 * (с `heroTitleAccent`, `heroImage`, числами без источника) не ломает ни форму, ни лендинг.
 */
const KEY = 'landing.content'

export const LANDING_LANGS = ['en', 'ru'] as const
export type LandingLang = (typeof LANDING_LANGS)[number]

export { LANDING_KEYS, type LandingKey } from '@/shared/landing-keys'
const KNOWN = new Set<string>(LANDING_KEYS)

/**
 * Плитка полосы доверия. `source` ОБЯЗАТЕЛЕН: число на витрине — утверждение, и у него
 * должен быть проверяемый источник (ADR-0005: на лендинге только живые данные). Здесь уже
 * стояли «12k+ публичных списков» — величины, которых никогда не было. Плитка без
 * источника не сохраняется и не отдаётся. Наружу уходят только `num` и `label`.
 */
export interface LandingStat {
  num: string
  label: string
  source: string
}

export interface LandingLangOverrides {
  texts: Partial<Record<LandingKey, string>>
  stats: LandingStat[]
}
export type LandingOverrides = Record<LandingLang, LandingLangOverrides>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function stat(v: unknown): LandingStat | undefined {
  if (!isRecord(v)) return undefined
  const num = str(v.num)
  const label = str(v.label)
  const source = str(v.source)
  if (!num || !label || !source) return undefined
  if (num.length > STAT_MAX.num || label.length > STAT_MAX.label || source.length > STAT_MAX.source) return undefined
  return { num, label, source }
}

/**
 * Правки одного языка: только известные ключи с непустой строкой и плитки с источником.
 * Принимает и форму хранилища (строки прямо у языка), и форму редактора (`texts`).
 */
export function sanitizeLang(raw: unknown): LandingLangOverrides {
  const out: LandingLangOverrides = { texts: {}, stats: [] }
  if (!isRecord(raw)) return out
  const texts = isRecord(raw.texts) ? raw.texts : raw
  for (const [k, v] of Object.entries(texts)) {
    const s = str(v)
    if (s && KNOWN.has(k) && s.length <= landingMaxLength(k)) out.texts[k as LandingKey] = s
  }
  if (Array.isArray(raw.stats)) out.stats = raw.stats.map(stat).filter((s): s is LandingStat => !!s).slice(0, LANDING_MAX_STATS)
  return out
}

/**
 * Что из присланного НЕ будет сохранено — называется, а не теряется молча: плитка без
 * источника или не до конца заполненная, лишняя плитка, строка сверх лимита. Экшен
 * сохранения отказывает с этим списком; `sanitize` при чтении отсеивает то же самое.
 */
export function landingProblems(raw: unknown): string[] {
  const out: string[] = []
  const r = isRecord(raw) ? raw : {}
  for (const l of LANDING_LANGS) {
    const lang = isRecord(r[l]) ? r[l] : {}
    const texts = isRecord(lang.texts) ? lang.texts : lang
    for (const [k, v] of Object.entries(texts)) {
      const s = str(v)
      if (s && KNOWN.has(k) && s.length > landingMaxLength(k)) out.push(`${l}.${k}: longer than ${landingMaxLength(k)}`)
    }
    const stats = Array.isArray(lang.stats) ? lang.stats : []
    const filled = stats.filter((x) => isRecord(x) && (str(x.num) || str(x.label) || str(x.source)))
    if (filled.length > LANDING_MAX_STATS) out.push(`${l}.stats: at most ${LANDING_MAX_STATS} tiles`)
    filled.forEach((x, i) => {
      if (!stat(x)) out.push(`${l}.stats[${i + 1}]: value, label and source are required (within ${STAT_MAX.num}/${STAT_MAX.label}/${STAT_MAX.source} chars)`)
    })
  }
  return out
}

export function sanitizeOverrides(raw: unknown): LandingOverrides {
  const r = isRecord(raw) ? raw : {}
  return { en: sanitizeLang(r.en), ru: sanitizeLang(r.ru) }
}

/** Сохранённые правки (безопасно к битому JSON и к старому формату). */
export async function getLandingOverrides(): Promise<LandingOverrides> {
  const raw = (await getSettings([KEY]))[KEY]
  if (!raw) return sanitizeOverrides(null)
  try {
    return sanitizeOverrides(JSON.parse(raw))
  } catch {
    return sanitizeOverrides(null)
  }
}

/** Сохранить правки (админ). Нет ни одной — ключ удаляется: лендинг целиком на своём словаре. */
export async function saveLandingOverrides(input: unknown): Promise<void> {
  const clean = sanitizeOverrides(input)
  const empty = LANDING_LANGS.every((l) => !Object.keys(clean[l].texts).length && !clean[l].stats.length)
  await saveSettings({
    [KEY]: empty ? '' : JSON.stringify(Object.fromEntries(LANDING_LANGS.map((l) => [l, { ...clean[l].texts, stats: clean[l].stats }]))),
  })
}

/**
 * `content` для `/api/landing`: только то, что сохранено. Язык без правок не отдаётся
 * вовсе; `stats` — только если заданы, и без `source` (лендингу нужны `num` и `label`).
 */
export function landingApiContent(o: LandingOverrides): Partial<Record<LandingLang, Record<string, unknown>>> {
  const out: Partial<Record<LandingLang, Record<string, unknown>>> = {}
  for (const l of LANDING_LANGS) {
    const { texts, stats } = o[l]
    const body: Record<string, unknown> = { ...texts }
    if (stats.length) body.stats = stats.map(({ num, label }) => ({ num, label }))
    if (Object.keys(body).length) out[l] = body
  }
  return out
}

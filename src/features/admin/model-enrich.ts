import 'server-only'
import { modelUsageStats, STATS_WINDOW_DAYS, type ModelUsageStat } from '@/shared/ai/model-stats'
import { modelRoles, type ModelRole } from '@/shared/ai/model-roles'
import { fitOf, getCapabilities, type EmbedCapability } from '@/shared/ai/embed-capability'
import { COLUMN_DIM } from '@/shared/ai/embed-space'
import { rubPerUsd } from '@/shared/ai/pricing'
import { tr } from '@/shared/i18n'
import type { Currency } from './model-options'
import type { ModelGroup, OptionMeta } from './ModelSelect'

/**
 * ОБОГАЩЕНИЕ СЕЛЕКТА: наш опыт + занятость, готовыми строками.
 *
 * Форматирование живёт здесь, а не в компоненте, по той же причине, что и форматирование цен
 * (model-options): валюты и пороги у провайдеров разные, а копия правил в клиенте однажды
 * разъедется — и цифры начнут врать. Компонент получает готовое и только раскладывает.
 *
 * Цена НАШЕГО вызова приводится к валюте каталога: рядом с «₽ за 1М токенов» долларовая
 * средняя читалась бы как ещё один прайс, а не как факт нашего расхода.
 */

export { STATS_WINDOW_DAYS }

/** Группа = наш опыт с моделью. Порядок групп в списке задаёт GROUP_ORDER в ModelSelect. */
export function groupOf(assigned: boolean, stat: ModelUsageStat | undefined): ModelGroup {
  if (assigned) return 'active'
  return stat && stat.calls > 0 ? 'tried' : 'fresh'
}

function costText(usd: number, cur: Currency, rate: number): string {
  if (!usd) return ''
  const v = cur === 'RUB' ? usd * rate : usd
  const sign = cur === 'RUB' ? '₽' : '$'
  // Мелкие суммы обрезать до копеек нельзя: почти весь наш расход живёт левее второго знака.
  return `${sign}${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`
}

function p95Text(ms: number, ru: boolean): string {
  if (!ms) return ''
  const v = (ms / 1000).toFixed(ms < 10_000 ? 1 : 0)
  return tr({ en: `${v}s`, ru: `${v}с` }, ru ? 'ru' : 'en')
}

function holderOf(r: ModelRole): NonNullable<OptionMeta['holders']>[number] {
  return { kind: r.kind, label: r.label, what: r.what, avatarUrl: r.avatarUrl, gnomeId: r.gnomeId, order: r.order }
}

/**
 * Как измеренная мерность ляжет в нашу колонку — человеческим текстом. Цифра колонки берётся
 * из схемы (COLUMN_DIM), а мерность модели — из измерения: ни одного числа «по памяти».
 */
function embedNote(cap: EmbedCapability, ru: boolean): NonNullable<OptionMeta['embed']> {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const fit = fitOf(cap.dim)
  if (fit === 'exact')
    return {
      fit,
      text: String(cap.dim),
      hint: say(`Returns ${cap.dim} — exactly the column width.`, `Отдаёт ${cap.dim} — ровно ширина колонки.`),
    }
  if (fit === 'truncated')
    return {
      fit,
      text: `${cap.dim} → ${COLUMN_DIM}`,
      hint: say(
        `Returns ${cap.dim}: we truncate to ${COLUMN_DIM} and re-normalise — quality drops unless the model is Matryoshka-trained.`,
        `Отдаёт ${cap.dim}: усечём до ${COLUMN_DIM} и перенормируем — качество ниже, если модель не матрёшечная.`,
      ),
    }
  return {
    fit,
    text: `${cap.dim} → ${COLUMN_DIM}`,
    hint: say(
      `Returns ${cap.dim}: we pad with zeros to ${COLUMN_DIM} — cosine similarity is preserved exactly.`,
      `Отдаёт ${cap.dim}: дополним нулями до ${COLUMN_DIM} — косинусная близость сохраняется точно.`,
    ),
  }
}

/**
 * Мета по всем моделям, которые нам встречались: ключ — id модели (базовый, без ':online').
 * Возвращаем и то, что в каталоге не встретится (снятые с обслуживания, ручные id) — страница
 * моделей по этому и узнаёт, что назначена мёртвая модель.
 *
 * Сети здесь нет: измеренные мерности читаются из памяти стенда (их пишут обычные вызовы
 * эмбеддингов и явная проба при сохранении), поэтому список открывается без ожидания.
 */
export async function modelMeta(cur: Currency, ru: boolean): Promise<Map<string, OptionMeta>> {
  // Курс берём ОДИН раз на сборку меты: он общий для всех строк.
  const [stats, roles, caps, rate] = await Promise.all([modelUsageStats(), modelRoles(ru), getCapabilities(), rubPerUsd()])
  const byModel = new Map<string, EmbedCapability>()
  for (const c of Object.values(caps)) byModel.set(c.model, c)
  const out = new Map<string, OptionMeta>()
  const ids = new Set<string>([...stats.keys(), ...roles.byModel.keys(), ...byModel.keys()])
  for (const id of ids) {
    const stat = stats.get(id)
    const holders = roles.byModel.get(id)
    const cap = byModel.get(id)
    out.set(id, {
      group: groupOf(Boolean(holders?.length), stat),
      calls: stat?.calls,
      okPct: stat && stat.calls > 0 ? Math.round(stat.okRate * 100) : undefined,
      p95: p95Text(stat?.p95Ms ?? 0, ru),
      ourCost: costText(stat?.avgCostUsd ?? 0, cur, rate),
      spent: costText(stat?.costUsd ?? 0, cur, rate),
      quarantined: stat?.quarantined ?? false,
      holders: holders?.map(holderOf),
      embed: cap ? embedNote(cap, ru) : undefined,
    })
  }
  return out
}

/** Мета для модели, которой в карте нет: она нам ещё не встречалась. */
export const FRESH_META: OptionMeta = { group: 'fresh' }

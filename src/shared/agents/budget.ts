/**
 * БУХГАЛТЕР — чистая логика тревог о деньгах. Никаких запросов и отправки: только «вот числа —
 * вот что с ними не так», чтобы правила можно было проверить тестом, а не наблюдением за
 * счётом.
 *
 * Три правила, и каждое отвечает на свой вопрос владельца:
 *   1. «Не проедаем ли дневной кап?» — предупреждаем ДО потолка, а не по факту остановки;
 *   2. «Надолго ли хватит остатка?» — в днях по среднему расходу, а не в долларах: доллары
 *      ничего не говорят, дни говорят всё;
 *   3. «Не случилось ли скачка?» — расход резко выше недельного среднего значит, что что-то
 *      идёт не так, даже если кап ещё не пробит.
 */

export interface Money {
  /** Потрачено сегодня, USD. */
  spentToday: number
  /** Средний расход за сутки по последней неделе, USD. */
  avgDay: number
  /** Дневной потолок инстанса; 0 = потолка нет. */
  dailyCap: number
  /** Остаток у провайдера; null = провайдер не ответил (это НЕ ноль). */
  balance: number | null
}

export type AlertKind = 'cap-near' | 'runway-short' | 'spike'

export interface BudgetAlert {
  kind: AlertKind
  subject: string
  text: string
}

/** Порог «подходим к капу»: 80% — успеть среагировать до остановки работ. */
export const CAP_WARN_SHARE = 0.8

/** Меньше этого числа дней остатка — повод пополнить. */
export const RUNWAY_WARN_DAYS = 5

/** Во сколько раз расход должен превысить среднее, чтобы считаться скачком. */
export const SPIKE_FACTOR = 3

const usd = (x: number): string => `$${x.toFixed(2)}`

export function budgetAlerts(m: Money): BudgetAlert[] {
  const out: BudgetAlert[] = []

  if (m.dailyCap > 0 && m.spentToday >= m.dailyCap * CAP_WARN_SHARE) {
    out.push({
      kind: 'cap-near',
      subject: 'дневной расход подходит к потолку',
      text: `Сегодня потрачено ${usd(m.spentToday)} при потолке ${usd(m.dailyCap)}. На потолке фоновая работа компании останавливается до завтра.`,
    })
  }

  // Остаток null = провайдер не ответил. Молчим: выдуманная тревога хуже её отсутствия.
  if (m.balance != null && m.avgDay > 0) {
    const days = m.balance / m.avgDay
    if (days < RUNWAY_WARN_DAYS) {
      out.push({
        kind: 'runway-short',
        subject: 'остатка хватит ненадолго',
        text: `Остаток ${usd(m.balance)} при среднем расходе ${usd(m.avgDay)} в сутки — это примерно ${days.toFixed(1)} дн.`,
      })
    }
  }

  // Скачок считаем только когда есть с чем сравнивать: первая неделя работы даёт нулевое
  // среднее, и любой расход выглядел бы «скачком».
  if (m.avgDay > 0.01 && m.spentToday > m.avgDay * SPIKE_FACTOR) {
    out.push({
      kind: 'spike',
      subject: 'расход резко выше обычного',
      text: `Сегодня ${usd(m.spentToday)} против среднего ${usd(m.avgDay)} в сутки — больше чем в ${SPIKE_FACTOR} раза.`,
    })
  }

  return out
}

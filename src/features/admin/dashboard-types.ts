// Типы дашборда — отдельным файлом БЕЗ `server-only`, чтобы клиентский DashboardLive мог
// импортировать LiveMetrics как тип, не притягивая серверный dashboard-queries в клиентский бандл.

/** Живой снимок «прямо сейчас» — то, что опрашивает /api/admin/metrics каждые ~15с. */
export interface LiveMetrics {
  onlineAuth: number // вошедшие с активной сессией за 5 мин (точно, из sessions.lastSeenAt)
  onlineAll: number | null // все посетители вкл. анонимов (Umami active); null = Umami не настроен/сбой
  umamiConfigured: boolean
  spendToday: number // сумма ai_usage.cost_usd за сегодня (UTC-сутки)
  dailyCap: number // AI_DAILY_USD (0 = кап выключен)
  balance: number | null // живой остаток OpenRouter; null = эндпоинт недоступен
  runwayGens: number | null // на сколько генераций хватит остатка по средней за 30д
  queue: { pending: number; processing: number; failed: number } // задачи type='generate'
  today: {
    generations: number
    generationsFailed: number
    signups: number
    newLists: number
    published: number
    forks: number
  }
}

/** Дневные серии для графиков тренда (сетка последних N суток, пустые дни = 0). */
export interface DashboardSeries {
  days: string[] // ISO-даты, старые → новые
  spend: number[] // $/сутки
  generations: number[]
  newLists: number[]
  signups: number[]
}

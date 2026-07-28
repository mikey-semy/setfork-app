import type { LoopName } from '@/shared/agents/policy'

/**
 * ПРОВОДКА ПЕТЕЛЬ — часть composition root, вынесенная отдельно, чтобы её можно было
 * проверить тестом, не запуская сервер.
 *
 * Здесь и только здесь петля из реестра (`shared/agents/loops`) соединяется с реальными
 * функциями: обработчиком задачи и планировщиком. Импорты СТАТИЧЕСКИЕ (`import('@/…')` с
 * литералом) — динамический путь из переменной сломал бы сборку Next: сборщику нужно видеть
 * модуль глазами, а не вычислять строку.
 *
 * Контракт держит `tests/shared/agents/loops-contract.itest.ts`: множество ключей здесь обязано
 * совпадать с реестром петель. Добавил петлю в реестр и забыл проводку (или наоборот) — тест
 * красный. Именно так `feedpull` уехал с обработчиком, но без самозапуска: первая задача сбора
 * не встала бы никогда, и петля молчала бы без единой ошибки.
 */
export interface LoopWiring {
  /** Обработчик задачи для воркера. */
  handler: () => Promise<(payload: unknown) => Promise<void>>
  /** Поставить первую задачу в очередь, если её нет (самоподдержание без внешнего cron). */
  schedule: () => Promise<void>
}

export const LOOP_WIRING: Record<LoopName, LoopWiring> = {
  partners: {
    handler: () => import('@/features/partners/jobs').then((m) => m.runPartnersJob),
    schedule: () => import('@/features/partners/service').then((m) => m.ensurePartnersScheduled()),
  },
  gardener: {
    handler: () => import('@/features/gardener/jobs').then((m) => m.runGardenerJob),
    schedule: () => import('@/features/gardener/service').then((m) => m.ensureGardenerScheduled()),
  },
  selfgen: {
    handler: () => import('@/features/library/selfgen-jobs').then((m) => m.runSelfGenJob),
    schedule: () => import('@/features/library/selfgen').then((m) => m.ensureSelfGenScheduled()),
  },
  feedpull: {
    handler: () => import('@/features/feeds/jobs').then((m) => m.runFeedPullJob),
    schedule: () => import('@/features/feeds/service').then((m) => m.ensureFeedPullScheduled()),
  },
  triples: {
    handler: () => import('@/features/knowledge/jobs').then((m) => m.runTriplesJob),
    schedule: () => import('@/features/knowledge/service').then((m) => m.ensureTriplesScheduled()),
  },
  linkcheck: {
    handler: () => import('@/features/linkcheck/jobs').then((m) => m.runLinkcheckJob),
    schedule: () => import('@/features/linkcheck/service').then((m) => m.ensureLinkcheckScheduled()),
  },
  digest: {
    handler: () => import('@/features/digest/jobs').then((m) => m.runDigestJob),
    schedule: () => import('@/features/digest/service').then((m) => m.ensureDigestScheduled()),
  },
}

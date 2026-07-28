import type { JobType } from '@/shared/db'
import type { LoopName } from './policy'

/**
 * РЕЕСТР ПЕТЕЛЬ — единственное место, где записано, из чего петля состоит.
 *
 * Зачем он появился: `feedpull` был зарегистрирован обработчиком, но забыт в списке
 * самозапуска — первая джоба сбора не встала бы никогда, и петля молчала бы без единой
 * ошибки в логах (найдено 2026-07-28). Два рукописных списка в composition root неизбежно
 * разъезжаются: человек правит один и забывает второй.
 *
 * Теперь список ОДИН, а composition root собирает и обработчики, и самозапуск из него.
 * Тест `tests/shared/agents/loops-contract.itest.ts` держит контракт: у каждой петли есть
 * обработчик, планировщик и место в перечне автономных петель — то есть её можно поставить
 * на паузу, прогнать всухую и увидеть в журнале.
 *
 * Разовые джобы (письмо, генерация по запросу, переиндексация) сюда НЕ входят: они не петли,
 * их ставит пользовательское действие, и самозапуск им не нужен.
 */
export interface LoopSpec {
  /** Имя петли в политике и журнале (agent_loops.type, agent_actions.loop). */
  name: LoopName
  /** Тип задачи в очереди. Совпадает с name везде, кроме исторических исключений. */
  jobType: JobType
  /** Модуль-обёртка с обработчиком (тонкий, чтобы composition root не тянул фичу целиком). */
  jobsModule: string
  handler: string
  /** Модуль сервиса и функция самопланирования: без неё петля не проснётся сама. */
  serviceModule: string
  ensure: string
  /** Тратит ли петля деньги на модель — видно в обзоре и в рунбуках. */
  paid: boolean
  /** Одной строкой: что петля делает. Идёт в админку и документацию. */
  what: { en: string; ru: string }
}

export const LOOPS: LoopSpec[] = [
  {
    name: 'partners',
    jobType: 'partners',
    jobsModule: '@/features/partners/jobs',
    handler: 'runPartnersJob',
    serviceModule: '@/features/partners/service',
    ensure: 'ensurePartnersScheduled',
    paid: false,
    what: { en: 'turns signals into the development agenda', ru: 'превращает сигналы в повестку развития' },
  },
  {
    name: 'gardener',
    jobType: 'gardener',
    jobsModule: '@/features/gardener/jobs',
    handler: 'runGardenerJob',
    serviceModule: '@/features/gardener/service',
    ensure: 'ensureGardenerScheduled',
    paid: true,
    what: { en: 'improves lists and grows living feeds', ru: 'улучшает списки и растит живые ленты' },
  },
  {
    name: 'selfgen',
    jobType: 'selfgen',
    jobsModule: '@/features/library/selfgen-jobs',
    handler: 'runSelfGenJob',
    serviceModule: '@/features/library/selfgen',
    ensure: 'ensureSelfGenScheduled',
    paid: true,
    what: { en: 'specialists draft lists on their own initiative', ru: 'специалисты сами пишут черновики списков' },
  },
  {
    name: 'feedpull',
    jobType: 'feedpull',
    jobsModule: '@/features/feeds/jobs',
    handler: 'runFeedPullJob',
    serviceModule: '@/features/feeds/service',
    ensure: 'ensureFeedPullScheduled',
    paid: false,
    what: { en: 'pulls subscribed streams for fresh material', ru: 'тянет подписки на потоки за свежим материалом' },
  },
  {
    name: 'triples',
    jobType: 'triples',
    jobsModule: '@/features/knowledge/jobs',
    handler: 'runTriplesJob',
    serviceModule: '@/features/knowledge/service',
    ensure: 'ensureTriplesScheduled',
    paid: true,
    what: { en: 'mines facts from lists into the knowledge corpus', ru: 'добывает факты из списков в корпус знаний' },
  },
  {
    name: 'linkcheck',
    jobType: 'linkcheck',
    jobsModule: '@/features/linkcheck/jobs',
    handler: 'runLinkcheckJob',
    serviceModule: '@/features/linkcheck/service',
    ensure: 'ensureLinkcheckScheduled',
    paid: false,
    what: { en: 'walks list links and marks the dead ones', ru: 'обходит ссылки списков и помечает мёртвые' },
  },
  {
    name: 'digest',
    jobType: 'digest',
    jobsModule: '@/features/digest/jobs',
    handler: 'runDigestJob',
    serviceModule: '@/features/digest/service',
    ensure: 'ensureDigestScheduled',
    paid: false,
    what: { en: 'sends subscription digests to people', ru: 'рассылает людям дайджесты подписок' },
  },
  {
    name: 'changelog',
    jobType: 'changelog',
    jobsModule: '@/features/changelog/jobs',
    handler: 'runChangelogJob',
    serviceModule: '@/features/changelog/service',
    ensure: 'ensureChangelogScheduled',
    // Платная: второй язык записи добирается переводом через модель.
    paid: true,
    what: { en: 'keeps the public changelog fresh from GitHub', ru: 'держит публичный changelog свежим из GitHub' },
  },
]

/** Быстрый доступ по имени — админке и рунбукам. */
export const loopSpec = (name: string): LoopSpec | undefined => LOOPS.find((l) => l.name === name)

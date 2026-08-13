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
  /**
   * Действия, после которых МИР ИЗМЕНИЛСЯ, — по ним детектор холостого хода отличает
   * работу от кручения впустую. Поле обязательное: у каждой петли свой ответ на вопрос
   * «что значит сделать дело», общего списка тут быть не может.
   *
   * Раньше список был один на всех и состоял из действий над библиотекой (`list.*`),
   * потому что детектор писался под садовника. Наблюдательные петли — бухгалтер,
   * летописец, дозор ИИ, ревизия повестки — своих действий в нём не имели и потому в
   * админке ВСЕГДА показывались холостыми, хотя работали исправно: на проде это четыре
   * петли из пяти живых. Индикатор, который всегда красный, — не индикатор, настоящий
   * холостой ход в нём утонет. Находка A2 линзы 06.
   */
  progress: readonly string[]
  /** Одной строкой: что петля делает. Идёт в админку и документацию. */
  what: { en: string; ru: string }
}

export const LOOPS: LoopSpec[] = [
  {
    name: 'finance',
    jobType: 'finance',
    jobsModule: '@/features/backoffice/jobs',
    handler: 'runFinanceJob',
    serviceModule: '@/features/backoffice/service',
    ensure: 'ensureFinanceScheduled',
    paid: false,
    // money.alert со статусом ok в прогресс НЕ входит: эта запись — ЗАЯВКА на право
    // отправить письмо (резерв идемпотентного ключа), а не факт доставки. Недоставленная
    // тревога дописывается отдельной строкой 'skipped', и засчитай мы заявку за дело,
    // прогрессом считался бы как раз провал. Замечание авто-ревью на fe#800 (P2).
    progress: ['money.watch'],
    what: { en: 'watches spend and warns the owner', ru: 'следит за расходом и предупреждает владельца' },
  },
  {
    name: 'chronicle',
    jobType: 'chronicle',
    jobsModule: '@/features/backoffice/jobs',
    handler: 'runChronicleJob',
    serviceModule: '@/features/backoffice/service',
    ensure: 'ensureChronicleScheduled',
    paid: false,
    progress: ['day.report'],
    what: { en: 'sends the company day summary to the owner', ru: 'отправляет владельцу сводку дня компании' },
  },
  {
    name: 'aiwatch',
    jobType: 'aiwatch',
    jobsModule: '@/features/backoffice/jobs',
    handler: 'runAiWatchJob',
    serviceModule: '@/features/backoffice/service',
    ensure: 'ensureAiWatchScheduled',
    paid: false,
    // ai.watch пишется на спокойном проходе и в сухом прогоне, а доставленное извещение
    // о падении канала и о возврате — это ai.down / ai.recovered. Замечание авто-ревью
    // на fe#800 (P2).
    progress: ['ai.watch', 'ai.down', 'ai.recovered'],
    what: { en: 'tells the owner when the model channel goes down and when it is back', ru: 'сообщает владельцу, когда канал к модели лёг и когда вернулся' },
  },
  {
    name: 'partners',
    jobType: 'partners',
    jobsModule: '@/features/partners/jobs',
    handler: 'runPartnersJob',
    serviceModule: '@/features/partners/service',
    ensure: 'ensurePartnersScheduled',
    paid: false,
    progress: ['agenda.review'],
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
    // list.stable и list.fresh-none в прогресс НЕ входят намеренно: «улучшать нечего» —
    // законный ответ ухода, а не сделанное дело. Именно ради него и есть расхождение форком.
    progress: ['list.suggest', 'list.improve', 'list.publish', 'list.fork', 'list.grow'],
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
    progress: ['list.draft'],
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
    progress: ['feed.pull'],
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
    progress: ['mine'],
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
    progress: ['probe', 'linkcheck.sweep'],
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
    progress: ['send'],
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
    progress: ['changelog.refresh'],
    what: { en: 'keeps the public changelog fresh from GitHub', ru: 'держит публичный changelog свежим из GitHub' },
  },
]

/** Быстрый доступ по имени — админке и рунбукам. */
export const loopSpec = (name: string): LoopSpec | undefined => LOOPS.find((l) => l.name === name)

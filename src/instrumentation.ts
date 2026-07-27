// Хук старта Next (вызывается один раз при инициализации сервера).
// Валидируем окружение до того, как примем первый запрос — падаем рано и понятно.
//
// Заодно это COMPOSITION ROOT: единственное место, где инфраструктура (shared)
// связывается с фичами — реестры (обработчики джоб, источник индексации)
// собираются здесь и передаются вниз. Файл живёт вне слоёв (см.
// docs/architecture.md, «Границы слоёв»), поэтому ему можно импортировать всё.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { validateEnv } = await import('@/shared/env')
  validateEnv()

  // Источник полной переиндексации для shared/ai/index-run (админка «переиндексировать всё»).
  const [{ captureError }, { registerIndexSource }, { collectItems, purgeStaleEmbeddings }] = await Promise.all([
    import('@/shared/observability'),
    import('@/shared/ai/index-run'),
    import('@/features/library/reindex'),
  ])
  registerIndexSource({ collectItems, purgeStaleEmbeddings })

  // Барьер модерации: фасад library.addVersion после записи новой версии зовёт
  // пере-проверку. Связываем здесь (composition root), чтобы library не импортировал
  // moderation напрямую (границы слоёв: features не зависят друг от друга).
  const [{ registerAfterVersion }, { recheckList }] = await Promise.all([
    import('@/features/library/list-store'),
    import('@/features/moderation/moderate-list'),
  ])
  registerAfterVersion(recheckList)

  // Тот же барьер для АВТОНОМНОЙ публикации: список, опубликованный гейтом готовности
  // без человека, обязан пройти модерацию — иначе петля стала бы единственным путём в
  // паблик мимо проверки.
  const [{ registerModerationGate }, { gateListPublication }] = await Promise.all([
    import('@/shared/agents/publication'),
    import('@/features/moderation/moderate-list'),
  ])
  registerModerationGate(gateListPublication)

  // Фоновый воркер очереди задач. Idempotent, безопасен между инстансами.
  // Реестр обработчиков: по одному модулю jobs.ts на фичу-владельца.
  const [{ startWorker }, notifications, generation, library, digest, moderation, gardener, knowledge, linkcheck, selfgen, gnomeReview] = await Promise.all([
    import('@/shared/jobs/worker'),
    import('@/features/notifications/jobs'),
    import('@/features/generation/jobs'),
    import('@/features/library/jobs'),
    import('@/features/digest/jobs'),
    import('@/features/moderation/jobs'),
    import('@/features/gardener/jobs'),
    import('@/features/knowledge/jobs'),
    import('@/features/linkcheck/jobs'),
    import('@/features/library/selfgen-jobs'),
    import('@/features/library/gnome-review-jobs'),
  ])
  startWorker({
    email: notifications.runEmailJob,
    push: notifications.runPushJob,
    generate: generation.runGenerateJob,
    reindex: library.runReindexJob,
    digest: digest.runDigestJob,
    moderate: moderation.runModerateJobHandler,
    gardener: gardener.runGardenerJob,
    triples: knowledge.runTriplesJob,
    linkcheck: linkcheck.runLinkcheckJob,
    selfgen: selfgen.runSelfGenJob,
    gnome_review: gnomeReview.runGnomeReviewJob,
  })

  // Самоподдерживающиеся джобы: на старте гарантируем первую постановку в очередь;
  // отпечатки ранее скрытого/flagged — база для ловли повторных заливок.
  void import('@/features/digest/service')
    .then((m) => m.ensureDigestScheduled())
    .catch((e) => captureError(e, { where: 'digest.ensure' }))
  void import('@/features/gardener/service')
    .then((m) => m.ensureGardenerScheduled())
    .catch((e) => captureError(e, { where: 'gardener.ensure' }))
  void import('@/features/knowledge/service')
    .then((m) => m.ensureTriplesScheduled())
    .catch((e) => captureError(e, { where: 'triples.ensure' }))
  void import('@/features/linkcheck/service')
    .then((m) => m.ensureLinkcheckScheduled())
    .catch((e) => captureError(e, { where: 'linkcheck.ensure' }))
  // Ставим в очередь всегда: сама джоба проверит режим и в off/manual ничего не потратит.
  // Так переключение в 'auto' из админки начинает работать без рестарта.
  void import('@/features/library/selfgen')
    .then((m) => m.ensureSelfGenScheduled())
    .catch((e) => captureError(e, { where: 'selfgen.ensure' }))
  void import('@/features/moderation/moderate-list')
    .then((m) => m.ensureModerationFingerprints())
    .catch((e) => captureError(e, { where: 'moderation.fingerprints' }))
}

// Глобальный перехват НЕ пойманных серверных ошибок (server actions, route handlers,
// RSC-рендер) — идиоматичный хук Next. ЕДИНСТВЕННАЯ точка, где все такие ошибки уходят
// в captureError (структурный лог + Sentry). Раньше сбой экшена был виден только если
// всплывал в error-boundary; фоновые/мутационные ошибки терялись.
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string },
): Promise<void> {
  const { captureError } = await import('@/shared/observability')
  captureError(error, {
    where: 'request',
    path: request?.path,
    method: request?.method,
    routePath: context?.routePath,
    routeType: context?.routeType,
    renderSource: context?.renderSource,
  })
}

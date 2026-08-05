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

  // Эффекты ПРИНЯТОГО git-пуша исполняются фоновой задачей и трогают сразу четыре
  // области: библиотеку (предложение из ветки), наблюдателей, уведомления и модерацию.
  // Фиче git видеть их напрямую нельзя (границы слоёв), поэтому связываем здесь — тем же
  // приёмом, что и два барьера выше.
  const [{ registerPushEffectsPorts }, suggestionCore, watchQueries, notify, moderate] = await Promise.all([
    import('@/features/git/push-effects'),
    import('@/features/library/suggestion-core'),
    import('@/features/watch/queries'),
    import('@/features/notifications/notify'),
    import('@/features/moderation/moderate-list'),
  ])
  registerPushEffectsPorts({
    ensureBranchSuggestion: suggestionCore.ensureBranchSuggestion,
    watcherIds: watchQueries.getWatcherIds,
    notifyNewVersion: (recipientIds, { actorId, listId }) =>
      notify.notifyMany(recipientIds, { actorId, type: 'new_version', templateId: listId }),
    recheckList: moderate.recheckList,
  })

  // Фоновый воркер очереди задач. Idempotent, безопасен между инстансами.
  // Реестр обработчиков: по одному модулю jobs.ts на фичу-владельца.
  //
  // РАЗОВЫЕ джобы перечислены здесь руками — их ставит пользовательское действие.
  // ПЕТЛИ берутся из реестра shared/agents/loops: раньше их приходилось вписывать дважды
  // (обработчик + самозапуск), и `feedpull` уехал в прод с обработчиком, но без запуска.
  const [{ startWorker }, { LOOPS }, { LOOP_WIRING }, notifications, generation, library, moderation, gnomeReview, gnomeTask, mirror, gitPush] =
    await Promise.all([
      import('@/shared/jobs/worker'),
      import('@/shared/agents/loops'),
      import('@/instrumentation-loops'),
      import('@/features/notifications/jobs'),
      import('@/features/generation/jobs'),
      import('@/features/library/jobs'),
      import('@/features/moderation/jobs'),
      import('@/features/library/gnome-review-jobs'),
      import('@/features/library/gnome-task-jobs'),
      import('@/features/library/mirror-jobs'),
      import('@/features/git/push-effects'),
    ])
  const loopHandlers = Object.fromEntries(
    await Promise.all(LOOPS.map(async (l) => [l.jobType, await LOOP_WIRING[l.name].handler()] as const)),
  )
  // Финализаторы (второй реестр, необязательный) — для задач, чья смерть оставляет
  // что-то незакрытым. У генерации это статус 'pending': умер процесс, не дойдя до
  // finally, — и на экране вечный спиннер, пока кто-то не закроет генерацию.
  //
  // У подметальщика зеркал незакрытым остаётся не экран, а САМА ЦЕПОЧКА: задача
  // ставит преемника перед завершением, и смерть на последней попытке обрывает
  // повторы навсегда — до следующего рестарта процесса. Финализатор ставит
  // преемника за неё.
  const finalizers = { generate: generation.finalizeGenerateJob, mirror: mirror.finalizeMirrorJob }
  startWorker(
    {
      email: notifications.runEmailJob,
      push: notifications.runPushJob,
      generate: generation.runGenerateJob,
      reindex: library.runReindexJob,
      moderate: moderation.runModerateJobHandler,
      gnome_review: gnomeReview.runGnomeReviewJob,
      gnome_task: gnomeTask.runGnomeTaskJob,
      mirror: mirror.runMirrorJob,
      git_push: gitPush.runGitPushEffects,
      ...loopHandlers,
    },
    finalizers,
  )

  // Ф2: подметальщик упавших зеркал. Не петля агента (там политика, журнал и
  // предохранитель) — обычная инфраструктурная задача, поэтому здесь руками.
  void mirror.startMirrorSweepChain()

  // САМОЗАПУСК ПЕТЕЛЬ — из того же реестра, что и обработчики: два рукописных списка
  // неизбежно разъезжаются, и один раз уже разъехались (feedpull зарегистрирован, но не
  // запущен). Ставим в очередь ВСЕГДА: сама задача проверит режим и в off/manual ничего не
  // потратит — так переключение в 'auto' из админки начинает работать без рестарта.
  for (const l of LOOPS) {
    void LOOP_WIRING[l.name].schedule().catch((e) => captureError(e, { where: `${l.name}.ensure` }))
  }
  // Отпечатки ранее скрытого/flagged — база для ловли повторных заливок.
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

import 'server-only'
import { captureError } from '@/shared/observability'
import { enqueueJob } from '@/shared/jobs/queue'
import { recordAudit } from '@/shared/audit'
import { gitCore } from '@/features/git/core'
import { t, type Lang } from '@/shared/i18n'

/**
 * Эффекты ПРИНЯТОГО пуша: предложение из магической ветки, уведомления, аудит,
 * пере-проверка модерацией.
 *
 * Раньше всё это исполнялось внутри обработчика, между приёмом пака и ответом
 * git-клиенту: снимок каждой magic-ветки, создание предложения, чтение всех
 * наблюдателей, рассылка каждому, аудит и постановка модерации — под `await`, пока
 * клиент ждёт байты протокола. Чем больше наблюдателей и веток, тем шире окно между
 * фактической записью и ответом; таймаут прокси в этом окне давал худший исход из
 * возможных: данные записаны, а клиент считает push неуспешным и пушит снова
 * (карточка ревью 008).
 *
 * Теперь после приёма пака синхронно происходит ровно одна вещь — запись намерения в
 * очередь, — а исполняет эффекты фоновая задача. Сообщение, которое печатает ядро
 * («правка принята, предложение появится на странице списка»), сформулировано именно
 * так и обещанию не противоречит.
 *
 * Соседние фичи (библиотека, наблюдатели, уведомления, модерация) приходят сюда
 * ПОРТАМИ, а не импортами: границы слоёв запрещают фиче зависеть от фичи, и связывает
 * их composition root — тот же приём, что у `registerAfterVersion` и
 * `registerModerationGate`.
 */

/** Минимальный durable-снимок принятой записи: всё, что нужно эффектам, и ничего лишнего. */
export interface AcceptedPush {
  repo: { owner: string; slug: string }
  listId: string
  ownerId: string
  currentVersion: number
  /** Кто пушил. Без него рассылка не умеет промолчать автору (карточка 003). */
  actorId: string
  /** Переходное: ник для имени ветки у СТАРОГО ядра (см. `legacyBranch` ниже). */
  actorHandle: string
  lang: Lang
  /** Номер созданной версии; null — пуш без новой версии (например, только ветка правки). */
  newVersion: number | null
  magic: { branch: string; tipSha: string }[]
  /** Публичный список после правки перепроверяется модерацией; приватный — нет. */
  isPublic: boolean
  /**
   * Адрес, с которого пришёл пуш.
   *
   * Едет В ПЕЙЛОАДЕ, а не читается на месте: `recordAudit` без явного `ip` спрашивает
   * `headers()`, а тот существует только в request-контексте. У фоновой задачи его нет,
   * и журнал молча остался бы без адреса — то есть вынос доставки в очередь обеднил бы
   * аудит. Поймано тестом при выносе: «`headers` was called outside a request scope».
   */
  ip: string | null
}

/** Соседние фичи, без которых эффекты не исполнить. Связывает composition root. */
export interface PushEffectsPorts {
  /** Предложение по ветке: идемпотентно, повторный вызов обновляет то же самое. */
  ensureBranchSuggestion(input: {
    templateId: string
    ownerId: string
    currentVersion: number
    authorId: string
    branch: string
    note?: string
    legacyBranch?: string
  }): Promise<{ id: string; created: boolean }>
  /** Кому уходит «новая версия» (с учётом уровня подписки и видимости списка). */
  watcherIds(listId: string, event: 'versions'): Promise<string[]>
  /** Рассылка. `actorId` обязателен: по нему уведомление не уходит самому автору. */
  notifyNewVersion(recipientIds: string[], params: { actorId: string; listId: string }): Promise<void>
  /** Пере-проверка публичного списка после правки содержимого. */
  recheckList(listId: string): Promise<void>
}

let ports: PushEffectsPorts | null = null

export function registerPushEffectsPorts(p: PushEffectsPorts): void {
  ports = p
}

/**
 * Поставить эффекты в очередь. Единственное, что остаётся синхронным на пути пуша.
 *
 * Ошибку глушим здесь же: пак уже принят, версия создана, и отказ ПОСТАНОВКИ не имеет
 * права превратить успешный push в ошибку клиента. Такой сбой громко пишется в
 * наблюдаемость — молчаливое глотание однажды уже скрыло сбой рассылки.
 */
export async function scheduleAcceptedPushEffects(push: AcceptedPush): Promise<void> {
  try {
    await enqueueJob('git_push', push as unknown as Record<string, unknown>)
  } catch (e) {
    captureError(e, { where: 'git.push-effects.enqueue', slug: push.repo.slug })
  }
}

/**
 * Исполнение эффектов. Порядок шагов выбран так, чтобы ПОВТОР задачи был безопасен.
 *
 * Сначала идёт то, что идемпотентно: предложение привязано к ветке, и повторный вызов
 * обновляет то же самое предложение, а не создаёт второе. Ошибка на этом шаге бросается
 * наружу — очередь повторит.
 *
 * Дальше идут одноразовые эффекты: у уведомлений дедупа нет, поэтому повтор задачи
 * прислал бы человеку второе «новая версия». Их ошибки не бросаются, а пишутся в
 * наблюдаемость: до них дело доходит только после успешного первого шага, поэтому
 * повтора после них не будет.
 */
export async function runGitPushEffects(payload: unknown): Promise<void> {
  const push = payload as AcceptedPush
  const { repo, listId, ownerId, actorId } = push
  const slug = repo.slug
  if (!ports) {
    // Молча пропустить доставку нельзя: пуш уже принят, и человек ждёт предложение.
    captureError(new Error('push effects ports are not registered — accepted push went undelivered'), { where: 'git.push-effects', slug })
    return
  }
  const p = ports

  const suggestions: { id: string; branch: string; tipSha: string; created: boolean }[] = []
  for (const m of push.magic ?? []) {
    // Ветка обязана материализоваться в список — ровно как на пути кнопки «Открыть
    // предложение». Хук требует наличия list.json, но не его разбираемости: битый JSON
    // проходит `cat-file -e`. Предложение, которое не рендерится, хуже отсутствующего
    // (авто-ревью fe#636). Это не ошибка задачи: повторять нечего, ветка такая и есть.
    const snap = await gitCore.branchSnapshot(repo, m.branch).catch(() => null)
    if (!snap) {
      captureError(new Error('magic push: branch does not materialize as a list'), { where: 'git.magic-push', slug, branch: m.branch })
      continue
    }
    const sug = await p.ensureBranchSuggestion({
      templateId: listId,
      ownerId,
      currentVersion: push.currentVersion,
      authorId: actorId,
      branch: m.branch,
      note: await terminalPushNote(repo, m.branch, push.lang),
      // ПЕРЕХОДНОЕ: как ветка называлась бы у ядра до Ф5 — по нику. Нужно, чтобы ревизия
      // правки, начатой в окно выкатки, продолжила ТО ЖЕ предложение. Убрать вместе с
      // `actorHandle` в запросе к ядру.
      legacyBranch: push.actorHandle ? `u/${push.actorHandle}/${m.branch.split('/')[2] ?? 'main'}` : undefined,
    })
    suggestions.push({ id: sug.id, branch: m.branch, tipSha: m.tipSha, created: sug.created })
  }

  // ── Дальше — одноразовое: повтор задачи сюда уже не дойдёт (см. док выше) ──
  for (const s of suggestions) {
    await once('git.suggest-audit', { slug, branch: s.branch }, () =>
      recordAudit('git.suggest', {
        actorId,
        ip: push.ip,
        targetType: 'suggestion',
        targetId: s.id,
        meta: { slug, branch: s.branch, tip: s.tipSha, revision: s.created ? 'first' : 'new' },
      }),
    )
  }

  if (push.newVersion == null) return

  await once('git.push-notify', { slug }, async () => {
    // Список наблюдателей читается из БД, и его сбой роняет ответ на УЖЕ принятый пуш:
    // `.catch()` стоял только на рассылке, строкой ниже (карточка 002).
    const watchers = await p.watcherIds(listId, 'versions')
    // actorId — не украшение: уведомление не уходит автору события. Без него владелец,
    // наблюдающий за собственным списком (а он наблюдает — `ensureWatch` подписывает его
    // при создании), получал письмо и пуш о своём же `git push` (карточка 003).
    await p.notifyNewVersion(watchers, { actorId, listId })
  })

  await once('git.push-audit', { slug }, () =>
    recordAudit('git.push', { actorId, ip: push.ip, targetType: 'list', targetId: listId, meta: { version: push.newVersion, slug } }),
  )

  // push меняет title/desc/tags минуя формы → пере-проверяем публичный список в фоне.
  if (push.isPublic) await once('git.push-recheck', { slug }, () => p.recheckList(listId))
}

/** Шаг, который выполняется ровно один раз: его сбой не должен вызывать повтор задачи. */
async function once(where: string, ctx: Record<string, unknown>, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (e) {
    captureError(e, { where, ...ctx })
  }
}

/**
 * Заголовок предложения, пришедшего из терминала.
 *
 * По умолчанию предложение берёт `Merge branch '<ветка>'`, а ветку магическому пушу
 * называет сервер — `u/<идентификатор>/<база>`. В списке предложений это самая крупная
 * строка карточки, и в ней торчал бы внутренний идентификатор: подпись `branchLabel`
 * прячет его в метаданных, но заголовок лежит в базе отдельным полем и форматтеру не
 * подчиняется (авто-ревью fe#662).
 *
 * Берём тему коммита — ровно как GitHub, который подставляет в заголовок PR тему
 * единственного коммита, а при нескольких переходит на имя ветки. Имя ветки нам не
 * годится, поэтому вторая ветка развилки — общая подпись.
 *
 * Ошибку глотаем: заголовок — не повод отменять уже принятый пуш.
 */
async function terminalPushNote(repo: { owner: string; slug: string }, branch: string, lang: Lang): Promise<string> {
  const commits = await gitCore.listCommits(repo, branch, { notIn: 'main', limit: 2 }).catch(() => null)
  // Первая строка сообщения: остальное — тело коммита, в заголовок ему нельзя.
  const subject = commits?.length === 1 ? (commits[0]?.message.split('\n')[0]?.trim() ?? '') : ''
  return subject || t('prFromTerminal', lang)
}

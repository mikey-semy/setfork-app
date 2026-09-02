/**
 * ЛЕНТА ЗАДАЧИ = РЕПЛИКИ ПЛЮС СОБЫТИЯ, ПО ВРЕМЕНИ.
 *
 * Реплики листаются ключом (тред бывает длинным), события — нет, их единицы. Значит
 * склеивать надо аккуратно: показать событие на КАЖДОЙ странице значило бы повторять
 * «закрыл задачу» под каждой порцией реплик, а показать только на первой — потерять
 * закрытие, случившееся после последней реплики.
 *
 * Правило простое и следует из того, что страница — это ОКНО ПО ВРЕМЕНИ:
 *  • событие внутри окна показывается всегда — оно случилось между этими репликами;
 *  • событие раньше первой реплики окна — только на первой странице;
 *  • событие позже последней — только на последней;
 *  • реплик нет вовсе — показываются все события.
 *
 * Модуль чистый: ни базы, ни разметки — потому что именно этот порядок и надо проверять.
 */
export interface ThreadPiece<C, E> {
  at: Date
  comment?: C
  event?: E
}

export function mergeThread<C extends { createdAt: Date }, E extends { createdAt: Date }>(
  comments: C[],
  events: E[],
  window: { isFirst: boolean; isLast: boolean },
): ThreadPiece<C, E>[] {
  const pieces: ThreadPiece<C, E>[] = comments.map((c) => ({ at: c.createdAt, comment: c }))

  const first = comments[0]?.createdAt
  const last = comments[comments.length - 1]?.createdAt
  for (const e of events) {
    const t = e.createdAt.getTime()
    const show =
      first === undefined
        ? true
        : t < first.getTime()
          ? window.isFirst
          : t > last!.getTime()
            ? window.isLast
            : true
    if (show) pieces.push({ at: e.createdAt, event: e })
  }

  // Порядок — по времени; при совпадении реплика идёт перед событием: закрывают ПОСЛЕ
  // того, как договорили, и обратный порядок читался бы как «закрыл, потом ответил».
  return pieces.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.comment ? -1 : 1) - (b.comment ? -1 : 1))
}

import { describe, expect, it } from 'vitest'
import { notificationHref } from '@/features/notifications/href'

/**
 * КУДА ВЕДЁТ УВЕДОМЛЕНИЕ — правило одно на страницу и колокольчик.
 *
 * Раньше оно было переписано в обоих местах, и расходились бы копии в ту сторону, что
 * замечают последней: добавив обсуждения на страницу, колокольчик я бы оставил вести «в
 * список» — то есть уведомление о разговоре высаживало бы человека там, где разговора не
 * видно.
 */
const base = {
  type: 'discussion_comment' as const,
  actorHandle: 'someone',
  ownerHandle: 'owner',
  slug: 'list',
  issueNumber: null,
  discussionNumber: null,
  suggestionId: null,
}

describe('адрес уведомления', () => {
  it('ведёт в ТРЕД, когда уведомление о нём', () => {
    expect(notificationHref({ ...base, discussionNumber: 7 })).toBe('/owner/list/discussions/7')
  })

  it('в задачу — когда о задаче', () => {
    expect(notificationHref({ ...base, type: 'issue_comment', issueNumber: 3 })).toBe('/owner/list/issues/3')
  })

  it('в правку — когда о правке', () => {
    expect(notificationHref({ ...base, type: 'suggestion_new', suggestionId: 's1' })).toBe('/owner/list/suggestions/s1')
  })

  it('подписка на человека ведёт к человеку, а не в список', () => {
    expect(notificationHref({ ...base, type: 'follow', actorHandle: 'ann' })).toBe('/ann')
  })

  it('без списка вести некуда — и это говорится null, а не ссылкой в никуда', () => {
    expect(notificationHref({ ...base, ownerHandle: null, slug: null })).toBeNull()
  })

  it('когда сущности нет, ведёт в список', () => {
    expect(notificationHref({ ...base, type: 'star' })).toBe('/owner/list')
  })
})

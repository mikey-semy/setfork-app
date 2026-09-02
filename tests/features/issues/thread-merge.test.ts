import { describe, expect, it } from 'vitest'
import { mergeThread } from '@/features/issues/thread'

/**
 * Склейка реплик и событий в одну ленту — при том, что реплики листаются, а события нет.
 *
 * Проверяются обе крайности: событие, повторённое на каждой странице, и событие,
 * пропавшее совсем. Обе ошибки тихие — лента выглядит правдоподобно и в том, и в другом
 * случае.
 */
const at = (min: number) => new Date(Date.UTC(2026, 8, 3, 12, min))
const c = (min: number, id: string) => ({ createdAt: at(min), id })
const e = (min: number, id: string) => ({ createdAt: at(min), id })

type Piece = { createdAt: Date; id: string }
const ids = (pieces: { comment?: Piece; event?: Piece }[]) => pieces.map((p) => (p.comment ?? p.event)!.id)

describe('лента задачи', () => {
  const events = [e(0, 'событие-до'), e(15, 'событие-между'), e(99, 'событие-после')]

  it('первая страница показывает то, что случилось до первой реплики', () => {
    const page = ids(mergeThread([c(10, 'р1'), c(20, 'р2')], events, { isFirst: true, isLast: false }))
    expect(page).toEqual(['событие-до', 'р1', 'событие-между', 'р2'])
  })

  it('средняя страница не повторяет чужие события', () => {
    const page = ids(mergeThread([c(10, 'р1'), c(20, 'р2')], events, { isFirst: false, isLast: false }))
    expect(page, 'событие «до» принадлежит первой странице, «после» — последней').toEqual(['р1', 'событие-между', 'р2'])
  })

  it('закрытие после последней реплики видно на последней странице', () => {
    const page = ids(mergeThread([c(10, 'р1'), c(20, 'р2')], events, { isFirst: false, isLast: true }))
    expect(page).toEqual(['р1', 'событие-между', 'р2', 'событие-после'])
  })

  it('в задаче без единой реплики события всё равно видны', () => {
    expect(ids(mergeThread([], events, { isFirst: true, isLast: true }))).toEqual([
      'событие-до',
      'событие-между',
      'событие-после',
    ])
  })

  it('при одинаковом времени реплика идёт перед событием', () => {
    // Закрывают ПОСЛЕ того, как договорили: обратный порядок читался бы как «закрыл,
    // потом ответил».
    const page = ids(mergeThread([c(10, 'реплика')], [e(10, 'событие')], { isFirst: true, isLast: true }))
    expect(page).toEqual(['реплика', 'событие'])
  })
})

import { describe, expect, it, vi } from 'vitest'

/**
 * ОТКАЗ НА ОТПРАВКЕ ПРАВКИ НЕ СТИРАЕТ ПРАВКУ.
 *
 * `/suggest` — редактор со ВСЕМИ пунктами чужого списка плюс заметка: человек приходит
 * сюда работать, а не заполнять два поля. Переход на `?e=…` начинал новый GET и уносил
 * всё набранное — причём на самых обидных отказах, где сама правка ни при чём:
 * «предложения закрыты» и «слишком часто».
 *
 * Мок перехода бросает: так видно попытку уйти со страницы, даже если возвращаемое
 * значение окажется верным.
 */
const h = vi.hoisted(() => ({
  tpl: null as null | Record<string, unknown>,
  rateOk: true,
  collaborator: false,
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`переход вместо значения: ${to}`)
  },
}))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => ({ userId: 'viewer', handle: 'viewer' }) }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('@/shared/rate-limit', () => ({ rateLimit: async () => ({ ok: h.rateOk }) }))
vi.mock('@/features/collab/queries', () => ({ isCollaborator: async () => h.collaborator }))
vi.mock('@/shared/db', () => ({
  db: { query: { templates: { findFirst: async () => h.tpl } } },
  templates: {},
  suggestions: {},
  users: {},
  steps: {},
  templateVersions: {},
  // Появился с исходом закрытия: путь подачи правки тянет побочные эффекты слияния, а те
  // теперь читают задачи. Мок обязан отдавать всё, что импортирует граф, — иначе падает
  // не проверка, а загрузка модуля.
  issues: {},
}))

const { submitSuggestion } = await import('@/features/library/actions/suggestion-submit')

const list = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  ownerId: 'owner',
  slug: 'spisok',
  visibility: 'public',
  status: 'published',
  moderation: 'active',
  archivedAt: null,
  frozenAt: null,
  prSettings: {},
  ...over,
})

const form = () => {
  const fd = new FormData()
  fd.set('note', 'Правка, которую жалко потерять')
  fd.set('items', '[]')
  return fd
}

describe('отказ на отправке правки', () => {
  it('предложения только от соавторов — отказ значением', async () => {
    h.tpl = list({ prSettings: { allowFrom: 'collaborators' } })
    h.collaborator = false
    expect(await submitSuggestion('t1', null, form())).toBe('suggest-closed')
  })

  it('слишком часто — отказ значением', async () => {
    h.tpl = list()
    h.rateOk = false
    try {
      expect(await submitSuggestion('t1', null, form())).toBe('ratelimited')
    } finally {
      h.rateOk = true
    }
  })

  it('заморожен — отказ значением, и он отличается от архива', async () => {
    h.tpl = list({ frozenAt: new Date() })
    expect(await submitSuggestion('t1', null, form())).toBe('frozen')
    h.tpl = list({ archivedAt: new Date() })
    expect(await submitSuggestion('t1', null, form())).toBe('archived')
  })

  it('чужой невидимый список — один общий ответ, а не оракул существования', async () => {
    // «Нет списка» и «список тебе не виден» обязаны отвечать ОДИНАКОВО: иначе по
    // разнице ответов перебором вычисляются приватные списки.
    h.tpl = null
    const missing = await submitSuggestion('t1', null, form())
    h.tpl = list({ visibility: 'private' })
    const hidden = await submitSuggestion('t1', null, form())
    expect(missing).toBe(hidden)
    expect(missing).toBe('unavailable')
  })
})

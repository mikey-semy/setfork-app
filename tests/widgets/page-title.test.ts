import { describe, expect, it } from 'vitest'
import { pageTitleKey } from '@/widgets/TopNav/page-title'

/**
 * Заголовок в шапке был лестницей из семнадцати вложенных тернарников и стал таблицей.
 * Тест держит соответствие «путь → подпись» ровно таким, каким оно было, — включая два
 * места, где порядок решает всё: `/admin/council` должен выигрывать у `/admin`, а
 * `/generate/history` намеренно остаётся «Сгенерировать» (так было и в лестнице).
 */
describe('pageTitleKey', () => {
  it.each([
    ['/search', 'searchTitle'],
    ['/search?q=x', 'searchTitle'],
    ['/explore', 'explore'],
    ['/explore/tags', 'explore'],
    ['/my-lists', 'myLists'],
    ['/runs', 'myRuns'],
    ['/runs/42', 'myRuns'],
    ['/settings', 'settings'],
    ['/generate', 'generateWithAi'],
    ['/generate/history', 'generateWithAi'],
    ['/new', 'newList'],
    ['/notifications', 'notifications'],
    ['/guilds', 'guildsTitle'],
    ['/trending', 'trending'],
    ['/collections', 'catalogsTab'],
    ['/tags', 'tags'],
    ['/feedback', 'feedback'],
    ['/admin', 'admin'],
    ['/admin/models', 'admin'],
  ])('%s → %s', (path, key) => {
    expect(pageTitleKey(path, true)).toBe(key)
  })

  it('частное правило выигрывает у общего: зал совета не «Админка»', () => {
    expect(pageTitleKey('/admin/council', true)).toBe('councilHall')
    expect(pageTitleKey('/admin/council/elder', true)).toBe('councilHall')
  })

  it('на корне заголовок только у вошедшего: гостю там hero с лого', () => {
    expect(pageTitleKey('/', true)).toBe('dashboard')
    expect(pageTitleKey('/', false)).toBeNull()
  })

  it('у чужого профиля и списка заголовка нет — там работает бредкрамб', () => {
    expect(pageTitleKey('/acme', true)).toBeNull()
    expect(pageTitleKey('/acme/deploy-to-vps', true)).toBeNull()
  })
})

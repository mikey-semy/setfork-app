import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { relSrc, walkSrc } from '../helpers/walk-src'

/**
 * ПУТЬ СТРАНИЦЫ НА КЛИЕНТЕ РАЗБИРАЮТ БЕЗ ЯЗЫКОВОГО ПРЕФИКСА.
 *
 * С SEO-1 у языка свой адрес: `/ru/alice/list`. Middleware снимает префикс только на
 * сервере, а `usePathname()` на клиенте отдаёт адрес браузера как есть. Каждый, кто по
 * нему разбирал, «где я», ломался одинаково: крошка принимала `ru` за владельца, вкладка
 * списка не подсвечивалась, действия корня списка пропадали (находка авто-ревью). Мест
 * было пять, и все пять написаны до того, как префикс появился, — шестое напишут так же.
 *
 * Поэтому `usePathname` зовут только через `usePagePath` — кроме тех, кто по пути
 * ПЕРЕХОДИТ: им префикс нужен, чтобы переход не сбрасывал язык адреса.
 */
const NAVIGATES_BY_PATH: Record<string, string> = {
  'src/shared/i18n/use-page-path.ts': 'сам общий хук',
  'src/features/profile/ListsToolbar.tsx': 'router.push(pathname + query) — переход, префикс сохраняется',
}

describe('путь страницы на клиенте', () => {
  it('usePathname зовут только через usePagePath либо ради перехода', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src', import.meta.url).pathname)) {
      if (!/\busePathname\s*\(/.test(readFileSync(file, 'utf8'))) continue
      const rel = relSrc(file)
      if (!(rel in NAVIGATES_BY_PATH)) offenders.push(rel)
    }
    expect(offenders, 'разбор пути с префиксом `/ru` примет язык за владельца — зовите usePagePath').toEqual([])
  })

  it('исключения живые: перечень не держит мёртвых записей', () => {
    for (const rel of Object.keys(NAVIGATES_BY_PATH)) {
      expect(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'), rel).toMatch(/\busePathname\s*\(/)
    }
  })
})

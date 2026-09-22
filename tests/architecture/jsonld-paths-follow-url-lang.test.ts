import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { relSrc, walkSrc } from '../helpers/walk-src'

/**
 * АДРЕСА В РАЗМЕТКЕ СТРАНИЦЫ — НА ЯЗЫКЕ АДРЕСА, ПО КОТОРОМУ ЕЁ ОТКРЫЛИ.
 *
 * Метаданные это правило соблюдают через `pageMeta`/`withLang` (узда
 * canonical-follows-url-lang). Разметка JSON-LD в теле страницы — отдельный путь, и он
 * отставал: у списка, открытого по `/ru/…`, `HowTo` описывал русские шаги адресом без
 * языка, то есть приписывал их версии, которую поисковик считает другой страницей
 * (находка авто-ревью к SEO-2). Так же были устроены крошки, `creativeWork`, профиль и
 * тег — все четыре страницы писали путь руками.
 *
 * Правило: страница, передающая разметке путь (`path:`), берёт его через `urlLangAt`.
 */
const ALLOWED: Record<string, string> = {
  'src/app/layout.tsx': 'разметка САЙТА (organization, webSite, softwareApplication) — одна на все языки, путей не принимает',
}

describe('разметка на языке адреса', () => {
  it('кто кладёт путь в JSON-LD, строит его через urlLangAt', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src/app', import.meta.url).pathname)) {
      const src = readFileSync(file, 'utf8')
      if (!/<JsonLd\b/.test(src) || !/\bpath\s*[:,]/.test(src)) continue
      if (/\burlLangAt\s*\(/.test(src)) continue
      const rel = relSrc(file)
      if (rel in ALLOWED) continue
      offenders.push(rel)
    }
    expect(offenders, 'разметка называет адрес без языка: на /ru/… она опишет другую страницу').toEqual([])
  })
})

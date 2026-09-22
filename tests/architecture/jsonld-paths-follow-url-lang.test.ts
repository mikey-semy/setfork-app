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

/**
 * Пути, которые страница кладёт в разметку: ключи `path`/`…Path` внутри `<JsonLd …/>`,
 * включая сокращённую запись `{ …, path }`. Смотрим КАЖДОЕ выражение, а не «вызов
 * помощника есть где-то в файле»: иначе один переведённый путь прикрывал бы соседний
 * сырой (находка авто-ревью к первой редакции этой узды).
 */
function rawJsonLdPaths(src: string): string[] {
  const bad: string[] = []
  // Переменная `path`, собранная через `at(…)`, — законная сокращённая запись.
  const pathVarLocalized = /\bconst\s+path\s*=\s*at\(/.test(src)
  for (const m of src.matchAll(/<JsonLd\b[\s\S]*?\/>/g)) {
    const block = m[0]
    for (const k of block.matchAll(/\b(\w*[pP]ath)\s*:\s*([^,}\n]+)/g)) {
      const expr = k[2].trim()
      if (expr.startsWith('at(')) continue
      if (expr === 'path' && pathVarLocalized) continue
      bad.push(`${k[1]}: ${expr}`)
    }
    for (const k of block.matchAll(/[{,]\s*path\s*(?=[,}])/g)) {
      if (!pathVarLocalized) bad.push(`{ path } — ${k[0].trim()}`)
    }
  }
  return bad
}

describe('разметка на языке адреса', () => {
  it('каждый путь в JSON-LD построен через at(…) из urlLangAt', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src/app', import.meta.url).pathname)) {
      const src = readFileSync(file, 'utf8')
      if (!/<JsonLd\b/.test(src)) continue
      const rel = relSrc(file)
      if (rel in ALLOWED) continue
      for (const b of rawJsonLdPaths(src)) offenders.push(`${rel} — ${b}`)
    }
    expect(offenders, 'разметка называет адрес без языка: на /ru/… она опишет другую страницу').toEqual([])
  })

  it('разбор видит сырой путь рядом с переведённым', () => {
    // Ровно тот случай, который первая редакция пропускала: один `at(…)` в файле есть.
    const src = `const at = await urlLangAt()
<JsonLd data={breadcrumbList([{ name: a, path: at('/a') }, { name: b, path: '/b' }])} />`
    expect(rawJsonLdPaths(src)).toEqual(["path: '/b'"])
  })
})

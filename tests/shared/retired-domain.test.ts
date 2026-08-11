import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Гейт списанного домена (линза 08, реестр 2026-08-11, находка R12).
 *
 * `setfork.ru` списан 11.08.2026, каноном стал `setfork.com`. Дефолты в коде про это
 * не узнали, и прод отдавал их живьём: подвал вёл на `setfork.ru/about`, а политика и
 * условия — на `docs.setfork.ru`. Заметить это по ревью нельзя: `NEXT_PUBLIC_*`
 * вшиваются при СБОРКЕ, поэтому «на проде переменная задана» ничего не спасает, а пока
 * старый сервер жив, ссылки исправно открываются.
 *
 * Что домен переживает переезды сам по себе — уже видно: #748 перенёс `ABOUT_URL` из
 * `Footer.tsx` в `shared/docs.ts` вместе с протухшим дефолтом. Поэтому гейт, а не разовая
 * правка.
 *
 * Держим именно адреса (`https://…setfork.ru`), а не упоминание домена: писать о нём в
 * комментариях и истории можно и нужно.
 */
const SRC = join(__dirname, '../../src')
const RETIRED = /https?:\/\/[a-z0-9.-]*setfork\.ru/gi

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(e.name) ? [path] : []
  })
}

describe('списанный домен не попадает в ссылки', () => {
  it('в src/ нет адресов на setfork.ru', () => {
    const hits = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => {
          const found = line.match(RETIRED)
          return found ? [`${file.slice(SRC.length + 1).replace(/\\/g, '/')}:${i + 1} → ${found[0]}`] : []
        }),
    )
    expect(hits, `ссылки на списанный домен:\n${hits.join('\n')}`).toEqual([])
  })
})

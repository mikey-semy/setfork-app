import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Узда единственного источника адреса (решение владельца 11.08.2026: «переменная домена
 * в одном месте и везде в проекте её использовать, как с переводами»).
 *
 * До неё адрес сервиса собирали 19 мест в 8 формах, с расходящимися дефолтами
 * (`https://setfork.com` в одних, `http://localhost:3000` в других) и даже с третьим
 * именем переменной (`SETFORK_APP_URL` — это имя из ЯДРА, во фронте оно не сработало бы
 * никогда). Именно так домен и протух молча при переезде с `setfork.ru`: поправили не везде.
 *
 * Теперь адрес живёт в `shared/site.ts` (публичный) и `shared/auth/app-origin.ts`
 * (серверный, `APP_URL`). Всё остальное берёт готовое. Тест — та же узда, что у словаря
 * переводов: новое место с `process.env.APP_URL` не проедет ревью незамеченным.
 */
const SRC = join(__dirname, '../../src')

/** Единственные файлы, которым положено читать env с адресом. */
const SOURCES = ['shared/site.ts', 'shared/auth/app-origin.ts']

/**
 * Домен буквами разрешён только там, где он НЕ адрес сервиса:
 *  - `TAG_AUTHORITY` в Atom — вечный идентификатор записи (RFC 4151), меняться не должен;
 *  - плейсхолдеры в формах админки — пример ввода, а не ссылка.
 */
const LITERAL_ALLOWED = [
  'app/[handle]/[slug]/releases.atom/route.ts',
  'features/admin/EmailSettingsForm.tsx',
  'features/admin/PushSettingsForm.tsx',
  'app/login/page.tsx',
]

const ENV_NAMES = /process\.env\.(APP_URL|SETFORK_APP_URL|NEXT_PUBLIC_SITE_URL|NEXT_PUBLIC_DOCS_URL|NEXT_PUBLIC_ABOUT_URL)/
const DOMAIN_LITERAL = /setfork\.(com|ru)/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(e.name) ? [path] : []
  })
}

/** Строка-комментарий: про домен можно писать словами, нельзя — вписывать его в код. */
const isComment = (line: string) => /^\s*(\/\/|\/?\*)/.test(line)

/** Путь от src/ через прямые слэши — одинаково на Windows и Linux. */
const rel = (file: string) => file.slice(SRC.length + 1).replace(/\\/g, '/')

function scan(match: RegExp, skip: string[]): string[] {
  return sourceFiles(SRC)
    .filter((f) => !skip.includes(rel(f)))
    .flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (match.test(line) && !isComment(line) ? [`${rel(file)}:${i + 1}`] : [])),
    )
}

describe('адрес сервиса живёт в одном месте', () => {
  it('env с адресом читают только shared/site.ts и shared/auth/app-origin.ts', () => {
    const hits = scan(ENV_NAMES, SOURCES)
    expect(hits, `эти файлы собирают адрес сами — возьми appOrigin() или SITE_ORIGIN:\n${hits.join('\n')}`).toEqual([])
  })

  it('домен буквами не появляется в коде вне разрешённых мест', () => {
    const hits = scan(DOMAIN_LITERAL, [...SOURCES, ...LITERAL_ALLOWED])
    expect(hits, `домен вписан буквами — возьми SITE_ORIGIN/SITE_HOST:\n${hits.join('\n')}`).toEqual([])
  })
})

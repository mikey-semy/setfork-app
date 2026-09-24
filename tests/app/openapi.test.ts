import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openApiDocument } from '@/app/openapi.json/document'
import { GET } from '@/app/openapi.json/route'

/**
 * OPENAPI 3.1 — ДОКУМЕНТ И КОД НЕ РАСХОДЯТСЯ (ревью соответствия 23.09, PR 2).
 *
 * Обе стороны: каждый путь документа — существующий маршрут, и каждый машинный маршрут
 * списка — в документе или в перечне исключений с причиной. Новый маршрут без записи
 * здесь краснеет: описание API, отстающее от кода, хуже его отсутствия.
 */
const doc = openApiDocument()
const LIST_DIR = 'src/app/[handle]/[slug]'

/** Машинные маршруты списка, которых в документе нет намеренно. */
const EXCLUDED: Record<string, string> = {
  '[...git]': 'git smart HTTP — описан протоколом git, а не OpenAPI',
}

/** `/{handle}/{slug}/badge/{kind}` → `src/app/[handle]/[slug]/badge/[kind]/route.ts`. */
const fileOf = (p: string) => join('src/app', p.replace(/\{([^}]+)\}/g, '[$1]'), 'route.ts')

/** Все route.ts под каталогом списка — относительными путями каталогов. */
function listRoutes(dir = LIST_DIR, rel = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (!statSync(full).isDirectory()) return []
    const here = rel ? `${rel}/${name}` : name
    return [...(existsSync(join(full, 'route.ts')) ? [here] : []), ...listRoutes(full, here)]
  })
}

describe('openapi.json', () => {
  it('OpenAPI 3.1, сервер — публичный адрес сайта', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.servers[0].url).toMatch(/^https?:\/\//)
  })

  it('каждый путь документа — существующий маршрут', () => {
    for (const p of Object.keys(doc.paths)) expect(existsSync(fileOf(p)), p).toBe(true)
  })

  it('каждый машинный маршрут списка — в документе или в исключениях с причиной', () => {
    const documented = new Set(Object.keys(doc.paths).map((p) => p.replace('/{handle}/{slug}/', '').replace(/\{([^}]+)\}/g, '[$1]')))
    for (const r of listRoutes()) expect(documented.has(r) || r in EXCLUDED, `маршрут ${r} не описан в openapi.json`).toBe(true)
    // Исключение без маршрута — мёртвая запись.
    for (const r of Object.keys(EXCLUDED)) expect(listRoutes(), r).toContain(r)
  })

  it('у каждого пути параметры пути объявлены', () => {
    for (const [p, item] of Object.entries(doc.paths)) {
      const names = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
      const declared = (item.get.parameters as { name: string; in: string }[]).filter((x) => x.in === 'path').map((x) => x.name)
      expect(declared.sort(), p).toEqual(names.sort())
    }
  })

  it('ошибки — схемой Problem (RFC 9457), и ссылка на неё разрешается', () => {
    const refs = JSON.stringify(doc.paths).match(/#\/components\/schemas\/\w+/g) ?? []
    expect(refs.length).toBeGreaterThan(0)
    for (const r of new Set(refs)) expect(doc.components.schemas).toHaveProperty(r.split('/').pop()!)
    expect(doc.components.schemas.Problem.required).toEqual(['type', 'title', 'status', 'error'])
  })

  it('отдаётся JSON-ом, доступным чужому браузерному коду', async () => {
    const res = GET()
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect((await res.json()).openapi).toBe('3.1.0')
  })
})

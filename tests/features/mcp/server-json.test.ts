import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mcpSurface } from '../../helpers/mcp-surface'
import { MCP_RESOURCE } from '@/shared/auth/oauth-meta'

/**
 * ЗАПИСЬ В РЕЕСТРЕ MCP (`server.json`) НЕ РАСХОДИТСЯ С СЕРВЕРОМ.
 *
 * Запись опубликована 07.07 и не обновлялась два с половиной месяца, хотя сервер за это время
 * получил десятки инструментов, сценарии и ресурсы. Теперь слепок поверхности лежит в самой
 * записи, этот тест сверяет его с кодом, а выкатка публикует новую версию, когда её в реестре
 * ещё нет (`scripts/mcp-registry-plan.py`, джоба `mcp-registry` в ci.yml).
 */
const doc = JSON.parse(readFileSync('server.json', 'utf8'))
const META = 'io.modelcontextprotocol.registry/publisher-provided'

describe('server.json', () => {
  it('слепок поверхности совпадает с кодом — иначе обнови его и подними version', () => {
    expect(doc._meta[META].surface).toEqual(mcpSurface())
  })

  it('запись: имя, адрес сервера MCP, semver, описание в пределах схемы', () => {
    expect(doc.name).toBe('com.setfork/setfork')
    expect(doc.remotes).toEqual([{ type: 'streamable-http', url: MCP_RESOURCE }])
    expect(doc.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(doc.description.length).toBeLessThanOrEqual(100)
  })

  it('данные издателя — в пределах 4 КБ, которые реестр принимает в publisher-provided', () => {
    expect(JSON.stringify(doc._meta[META]).length).toBeLessThan(4096)
  })
})

describe('план публикации (scripts/mcp-registry-plan.py)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-plan-'))
  const run = (published?: unknown, latest = '', local: unknown = doc) => {
    const localPath = join(dir, 'server.json')
    writeFileSync(localPath, JSON.stringify(local))
    const pub = join(dir, 'published.json')
    if (published !== undefined) writeFileSync(pub, JSON.stringify(published))
    const args = ['scripts/mcp-registry-plan.py', localPath, published === undefined ? join(dir, 'none.json') : pub, latest]
    return spawnSync('python3', args, { encoding: 'utf8' })
  }

  it('версии в реестре нет — publish', () => {
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('publish')
  })

  it('версия есть, поверхность та же — skip', () => {
    const r = run({ server: doc })
    expect(r.stdout.trim()).toBe('skip')
  })

  it('тело 404 — не запись: версии нет, publish', () => {
    expect(run({ title: 'Not Found', status: 404, detail: 'Server not found' }).stdout.trim()).toBe('publish')
  })

  it('версии нет, но она ниже последней опубликованной — отказ: последней она не станет', () => {
    const r = run(undefined, '9.0.0')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('ниже последней')
    // Выше последней — публикуется.
    expect(run(undefined, '1.0.1').stdout.trim()).toBe('publish')
  })

  it('версия есть, поверхность другая — отказ: версию не подняли', () => {
    const changed = structuredClone(doc)
    changed._meta[META].surface.tools = [...changed._meta[META].surface.tools, 'new_tool']
    const r = run({ server: changed })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('подними version')
  })
})

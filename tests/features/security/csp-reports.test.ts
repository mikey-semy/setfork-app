import { describe, expect, it } from 'vitest'
import { MAX_REPORTS_PER_BODY, parseCspReports } from '@/features/security/csp-reports'

/**
 * РАЗБОР ОТЧЁТОВ: оба формата браузеров приходят к одной записи.
 *
 * Тела ниже — формы из спецификаций: `report-uri` (CSP2, §4.4 «violation reports»,
 * так шлют Firefox и Safari) и Reporting API (`csp-violation`, так шлёт Chromium).
 */
const legacy = (over: Record<string, unknown> = {}) => ({
  'csp-report': {
    'document-uri': 'https://setfork.com/miki/list?token=secret',
    'violated-directive': "script-src-elem 'nonce-x' 'strict-dynamic'",
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://cdn.example/lib.js?v=1#frag',
    'source-file': 'https://setfork.com/_next/static/chunks/app.js',
    'line-number': 12,
    ...over,
  },
})
const modern = (body: Record<string, unknown>) => ({ type: 'csp-violation', url: 'https://setfork.com/', body })

describe('разбор отчётов CSP', () => {
  it('старый формат: директива без хвоста, адреса без query и фрагмента, страница — только путь', () => {
    expect(parseCspReports(legacy())).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'https://cdn.example/lib.js',
        source: 'https://setfork.com/_next/static/chunks/app.js',
        path: '/miki/list',
        line: 12,
      },
    ])
  })

  it('старый формат без effective-directive: берётся первое слово violated-directive', () => {
    const [v] = parseCspReports(legacy({ 'effective-directive': undefined }))
    expect(v.directive).toBe('script-src-elem')
  })

  it('Reporting API: массив, поля в camelCase, чужие типы отчётов пропускаются', () => {
    const got = parseCspReports([
      modern({ documentURL: 'https://setfork.com/a', effectiveDirective: 'script-src-elem', blockedURL: 'inline', lineNumber: 3 }),
      { type: 'deprecation', body: { id: 'x' } },
    ])
    expect(got).toEqual([{ directive: 'script-src-elem', blocked: 'inline', source: '', path: '/a', line: 3 }])
  })

  it('нарушение внутри расширения браузера — не наш скрипт, выбрасывается', () => {
    expect(parseCspReports(legacy({ 'source-file': 'chrome-extension://abc/content.js' }))).toEqual([])
    expect(parseCspReports(legacy({ 'blocked-uri': 'moz-extension://abc/x.js' }))).toEqual([])
  })

  it('не-http адрес сводится к схеме: data: и blob: не разрастаются в сводке', () => {
    const [v] = parseCspReports(legacy({ 'blocked-uri': 'data:text/javascript,alert(1)' }))
    expect(v.blocked).toBe('data')
  })

  it('директива не по форме — отчёт выбрасывается', () => {
    expect(parseCspReports(legacy({ 'effective-directive': "x'; drop table", 'violated-directive': '' }))).toEqual([])
  })

  it('непонятное тело — пусто, без исключения', () => {
    for (const body of [null, 1, 'x', {}, { 'csp-report': 'x' }, [1, null, 'x']]) expect(parseCspReports(body)).toEqual([])
  })

  it(`из пачки берутся первые ${MAX_REPORTS_PER_BODY}`, () => {
    const many = Array.from({ length: MAX_REPORTS_PER_BODY + 5 }, () => modern({ effectiveDirective: 'script-src-elem', blockedURL: 'eval' }))
    expect(parseCspReports(many)).toHaveLength(MAX_REPORTS_PER_BODY)
  })
})

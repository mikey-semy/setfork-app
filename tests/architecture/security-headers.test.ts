import { describe, expect, it } from 'vitest'
// ⚠️ Именно ТА копия, которой сопоставляет сам Next: в проекте рядом стоит
// path-to-regexp v8, где такой шаблон уже не разбирается, — проверка на ней
// падала бы на верном коде.
// @ts-expect-error -- у встроенной копии Next нет файла типов; берём её сознательно
import { pathToRegexp } from 'next/dist/compiled/path-to-regexp'
import config from '../../next.config.mjs'
import { LOCALES } from '@/shared/i18n'

/**
 * ЗАГОЛОВКИ БЕЗОПАСНОСТИ И ВСТРАИВАЕМАЯ СТРАНИЦА.
 *
 * Правило одно и неочевидное: запрет на чужие рамки (`frame-ancestors 'self'`) обязан
 * обойти `/:handle/:slug/embed` — этот адрес для того и существует, чтобы его вставляли
 * к себе. Две записи с разными CSP на один адрес дали бы ДВА заголовка, а браузер
 * применяет их пересечение, то есть самый строгий: встраивание перестало бы работать
 * молча, и заметили бы это не мы, а тот, у кого оно вставлено.
 *
 * ⚠️ Проверяем ПОВЕДЕНИЕМ — реальным сопоставлением адресов тем же `path-to-regexp`,
 * которым пользуется Next, а не текстом шаблона. Первая редакция исключения выглядела
 * правдоподобно (`/:path*embed`) и не совпадала ни с чем: встраиваемая страница осталась
 * вообще без базовых заголовков, включая `nosniff`. Проверка на текст этого бы не нашла.
 */
const EMBED = '/miki/spisok/embed'
const USUAL = '/miki/spisok'
/** ⚠️ Ник и слаг пишет ЧЕЛОВЕК — «embed» встречается в них законно. Эти адреса обязаны
 *  получить всё, включая запрет на чужие рамки: встраиваемая страница только одна. */
const TRAPS = ['/embedder/my-list', '/alice/embedded-guide', '/miki/spisok/embedding', '/embed-tips']

async function rules() {
  return (await (config as unknown as { headers: () => Promise<Array<{ source: string; headers: { key: string; value: string }[] }>> }).headers())
}

const hits = (source: string, path: string): boolean => (pathToRegexp as (s: string) => RegExp)(source).test(path)

describe('заголовки безопасности', () => {
  it('⚠️ встраиваемая страница НЕ получает запрет на чужие рамки', async () => {
    const csp = (await rules()).filter((r) => r.headers.some((h) => h.key === 'Content-Security-Policy'))
    expect(csp.length, 'правило с CSP ровно одно').toBe(1)
    expect(hits(csp[0].source, EMBED), 'CSP не должен доставать до embed').toBe(false)
    expect(hits(csp[0].source, USUAL), 'а до обычной страницы — должен').toBe(true)
  })

  it('⚠️ адрес, где «embed» лишь внутри ника или слага, защиту НЕ теряет', async () => {
    const all = await rules()
    const csp = all.filter((r) => r.headers.some((h) => h.key === 'Content-Security-Policy'))
    for (const path of TRAPS) {
      expect(hits(csp[0].source, path), `${path} остался без запрета на чужие рамки`).toBe(true)
      const applied = all.filter((r) => hits(r.source, path)).flatMap((r) => r.headers.map((h) => h.key))
      expect(applied, `${path}: nosniff`).toContain('X-Content-Type-Options')
    }
  })

  it('базовые заголовки достают до ОБОИХ адресов, включая embed', async () => {
    const all = await rules()
    for (const path of [USUAL, EMBED]) {
      const applied = all.filter((r) => hits(r.source, path)).flatMap((r) => r.headers.map((h) => h.key))
      expect(applied, `${path}: nosniff`).toContain('X-Content-Type-Options')
      expect(applied, `${path}: HSTS`).toContain('Strict-Transport-Security')
      expect(applied, `${path}: Permissions-Policy`).toContain('Permissions-Policy')
    }
  })
})

/**
 * COOP — ВЕЗДЕ, КРОМЕ ПУТИ ВХОДА. OAuth-клиент (claude.ai) вправе открыть авторизацию
 * всплывающим окном и ждать ответа через `opener`; страница с COOP на пути окна рвёт
 * эту связь навсегда. Путь входа — авторизация, страница входа (с подстраницами) и
 * колбэки провайдеров, с языковым префиксом и без.
 */
describe('Cross-Origin-Opener-Policy', () => {
  const coopOn = async (path: string) =>
    (await rules()).filter((r) => hits(r.source, path)).some((r) => r.headers.some((h) => h.key === 'Cross-Origin-Opener-Policy' && h.value === 'same-origin'))
  const LOGIN_FLOW = ['/oauth/authorize', '/oauth/token', '/login', '/login/telegram', '/api/auth/callback/github', '/api/auth/signin']

  it.each(LOGIN_FLOW)('%s — без COOP', async (path) => {
    expect(await coopOn(path)).toBe(false)
  })

  it('⚠️ языковой префикс не возвращает COOP на путь входа — по каждому языку словаря', async () => {
    for (const lang of LOCALES) for (const path of LOGIN_FLOW) expect(await coopOn(`/${lang}${path}`), `/${lang}${path}`).toBe(false)
  })

  // Ник и слаг пишет человек: «oauth» и «login» в них законны, защита не теряется.
  it.each([USUAL, EMBED, '/', '/explore', '/ru/explore', '/oauthfan/list', '/login-club', '/miki/login', '/ru/loginer/x'])('%s — с COOP', async (path) => {
    expect(await coopOn(path)).toBe(true)
  })
})

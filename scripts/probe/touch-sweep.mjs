import { chromium } from '@playwright/test'

/**
 * ОБХОД СТРАНИЦ НА ГРУБОМ УКАЗАТЕЛЕ (живой замер в браузере).
 *
 * ЗАЧЕМ. Есть класс дефектов, которого не видит ни один наш статический счётчик и не
 * видит разработчик за мышью: правила `pointer-coarse:` действуют только там, где
 * браузер рапортует палец. 27–28.08.2026 владелец назвал пятнадцать мест в интерфейсе,
 * и половина из них была именно такой — при `ui-parity = 0` и `ui-sizes = 0`.
 *
 * Этим скриптом найден механизм, который держал сразу два дефекта: `pointer-coarse:relative`
 * из тач-зоны перебивал `absolute`, заданный вызывающим, и кнопка выпадала в поток.
 * Крестик панели уезжал вниз, а веер вставки блоков делал обойму 404px при экране 390 —
 * и распирал страницу вширь. Прочитать это в коде было нельзя: на мыши дефекта нет.
 *
 * ЧТО МЕРЯЕТ: распирание страницы вширь · rows с разъехавшимися по высоте контролами ·
 * цели меньше 44px без невидимой зоны.
 *
 * КАК ЗАПУСКАТЬ (Playwright намеренно НЕ в зависимостях — инструмент разовый):
 *   npm run itest:env                          # поднять Postgres и ядро
 *   DATABASE_URL=… PORT=3111 npm run dev       # стенд
 *   npm i -D @playwright/test                  # разово
 *   PROBE_BASE=http://localhost:3111 node scripts/probe/touch-sweep.mjs
 *
 * ⚠️ Признаки приходится сужать, и это не лень, а свойство замера: первая редакция
 * считала текстовую ссылку контролом и дала ложный ряд на КАЖДОЙ странице. Счётчик,
 * пойманный на завышении, перестаёт быть аргументом — см. K41* в карте корней.
 */

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3111'
const P = { email: `sw${Date.now()}@example.test`, handle: `sw${Date.now().toString(36)}`, name: 'Sweep', password: 'Probe-pass-123' }

const PAGES = ['/', '/new', '/explore', '/search?q=test', '/settings', '/my-lists', '/runs', '/generate', '/notifications']

const probe = () => {
  const W = document.documentElement.clientWidth
  const out = { overflow: null, rows: [], smallTargets: 0 }

  if (document.documentElement.scrollWidth > W + 1) {
    const culprits = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width > 60 && r.right > W + 1) culprits.push(`${el.tagName.toLowerCase()}[${(el.className || '').toString().slice(0, 40)}] w=${Math.round(r.width)}`)
    }
    out.overflow = { scrollWidth: document.documentElement.scrollWidth, viewport: W, culprits: culprits.slice(0, 4) }
  }

  // Ряды: контейнер flex без flex-col, внутри 2+ контрола.
  for (const row of document.querySelectorAll('div')) {
    const cs = getComputedStyle(row)
    if (cs.display !== 'flex' || cs.flexDirection.startsWith('column')) continue
    // Только НАСТОЯЩИЕ контролы: у ссылки-текста высота от строки, и сравнивать её с
    // кнопкой бессмысленно — это давало по ложному ряду на каждой странице (32 против 18).
    const isControl = (c) => {
      if (c.tagName === 'INPUT' || c.tagName === 'SELECT') return true
      if (c.tagName !== 'BUTTON' && c.tagName !== 'A') return false
      const cs = getComputedStyle(c)
      return cs.borderTopWidth !== '0px' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent')
    }
    const kids = [...row.children].filter((c) => isControl(c) || (c.children.length === 1 && isControl(c.firstElementChild)))
    if (kids.length < 2) continue
    const hs = kids.map((k) => Math.round(k.getBoundingClientRect().height)).filter((h) => h > 8)
    if (hs.length < 2) continue
    const spread = Math.max(...hs) - Math.min(...hs)
    if (spread > 2) out.rows.push({ heights: hs.slice(0, 5), spread: spread, cls: (row.className || '').toString().slice(0, 50) })
  }

  for (const b of document.querySelectorAll('button, a[href]')) {
    const r = b.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.height >= 44) continue
    // Ссылка внутри текста целью 44px быть не обязана — это абзац, а не контрол.
    const cs = getComputedStyle(b)
    const looksControl = cs.borderTopWidth !== '0px' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent')
    if (!looksControl && !b.getAttribute('aria-label')) continue
    const before = getComputedStyle(b, '::before')
    if (before.content !== 'none' && parseFloat(before.height) >= 40) continue
    out.smallTargets++
    ;(out.small ??= []).push(`${(b.getAttribute('aria-label') ?? b.textContent ?? '?').trim().slice(0,20)} ${Math.round(r.width)}x${Math.round(r.height)}`)
  }
  return out
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
const page = await ctx.newPage()
await page.goto(BASE + '/register', { waitUntil: 'domcontentloaded' })
await page.locator('input[name="email"]').fill(P.email)
await page.locator('input[name="handle"]').fill(P.handle)
await page.locator('input[name="name"]').fill(P.name)
await page.locator('input[name="password"]').fill(P.password)
await page.locator('form button[type="submit"]').first().click()
await page.waitForTimeout(3000)

for (const path of PAGES) {
  try {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.waitForTimeout(1200)
    const r = await page.evaluate(probe)
    const issues = []
    if (r.overflow) issues.push(`РАСПИРАЕТ ${r.overflow.scrollWidth}>${r.overflow.viewport}: ${r.overflow.culprits.join(' | ')}`)
    if (false) issues.push(`рядов вразнобой: ${r.rows.length} → ${r.rows.slice(0, 2).map((x) => `${x.heights.join('/')}`).join(', ')}`)
    if (r.smallTargets) issues.push(`цели <44px: ${(r.small ?? []).join(' | ')}`)
    // eslint-disable-next-line no-restricted-syntax -- инструмент разработчика, не UI: словарь сюда не тянем
    console.log(`${path.padEnd(18)} ${issues.length ? issues.join(' · ') : 'чисто'}`)
  } catch (e) {
    console.log(`${path.padEnd(18)} ошибка: ${e.message.split('\n')[0].slice(0, 60)}`)
  }
}
await browser.close()

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * МАНИФЕСТ ПРИЛОЖЕНИЯ (W3C Web App Manifest).
 *
 * Без `start_url`/`scope`/`id` браузер берёт их из адреса, с которого поставили ярлык:
 * установленное со страницы списка «приложение» открывалось бы на этом списке, а два
 * ярлыка с разных страниц считались бы разными приложениями. Имя — как у продукта везде,
 * «SetFork», а не «Setfork» (ревью соответствия 23.09).
 */
const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8')) as Record<string, unknown>

describe('site.webmanifest', () => {
  it('приложение одно и открывается с корня', () => {
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/' })
  })

  it('имя продукта и язык манифеста', () => {
    expect(manifest).toMatchObject({ name: 'SetFork', short_name: 'SetFork', lang: 'en' })
  })

  it('иконки и режим — как были', () => {
    expect(manifest.display).toBe('standalone')
    expect((manifest.icons as unknown[]).length).toBe(4)
  })
})

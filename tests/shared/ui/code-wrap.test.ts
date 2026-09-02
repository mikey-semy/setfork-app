// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { CODE_WRAP_KEY, readCodeWrap } from '@/shared/lib/code-wrap'

/**
 * ПЕРЕНОС СТРОК — ОДИН ВЫБОР НА ПРОДУКТ И ВЫКЛЮЧЕН ПО УМОЛЧАНИЮ.
 *
 * Владелец увидел перенос дважды: во врезке разбора и в редакторе списка (02.09.2026).
 * В редакторе он был включён безусловно (`EditorView.lineWrapping`), хотя все, кто
 * правит код, по умолчанию его выключают: CodeMirror без этого расширения — наша же
 * основа, VS Code с `editor.wordWrap: "off"`, редактор файлов GitHub.
 *
 * Две настройки завести нельзя: человек переключал бы вид дважды и не понимал, почему
 * в одном месте перенос есть, а в другом нет.
 */
const read = (p: string) =>
  readFileSync(new URL('../../../' + p, import.meta.url).pathname, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '))

describe('выбор переноса строк', () => {
  beforeEach(() => window.localStorage.clear())

  it('по умолчанию выключен: пустое хранилище — не перенос', () => {
    expect(readCodeWrap()).toBe(false)
  })

  it('включённым считается только явная единица', () => {
    window.localStorage.setItem(CODE_WRAP_KEY, '1')
    expect(readCodeWrap()).toBe(true)
    window.localStorage.setItem(CODE_WRAP_KEY, '0')
    expect(readCodeWrap()).toBe(false)
  })

  it('редактор не включает перенос безусловно', () => {
    const src = read('src/shared/ui/CodeEditorInner.tsx')
    expect(src, 'lineWrapping должен зависеть от выбора, а не стоять всегда').not.toMatch(
      /extensions = useMemo\(\s*\(\) => \[[^\]]*EditorView\.lineWrapping/,
    )
    expect(src, 'выбор берётся из общего модуля, а не своей копии').toMatch(/useCodeWrap\(\)/)
  })

  it('просмотр и редактор читают ОДИН ключ, а не два', () => {
    const surface = read('src/shared/ui/CodeSurface.tsx')
    const editor = read('src/shared/ui/CodeEditorInner.tsx')
    for (const [name, src] of [
      ['врезка', surface],
      ['редактор', editor],
    ] as const) {
      expect(src, `${name} завёл свой ключ вместо общего`).not.toMatch(/'sf:code-wrap'/)
      expect(src, `${name} не пользуется общим модулем`).toMatch(/useCodeWrap/)
    }
  })
})

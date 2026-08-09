// Диалект оборачивает скрипт, но НЕ переводит авторские команды. `?lang=py` менял
// shebang, print() и расширение, а строки `command` вставлял как есть: `export FOO=bar`
// или конвейер в Python не компилируются, а часть команд в PowerShell означает другое.
// Раз модель списка не объявляет runtime, исполняемый выход честен ровно на одном
// диалекте, а остальным отказывают — вместо того чтобы подсунуть чужой код.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scriptRefusal, toRunnableScript, DIALECT_CANNOT_CARRY, type ExportList, type ExportStep } from '@/features/library/export'
import { AUTHORED_DIALECT, carriesCommands, dialectSpec, errorScript, type ScriptDialect } from '@/core/domain/script-dialect'

const DIALECTS: ScriptDialect[] = ['sh', 'ps1', 'py']
const FOREIGN = DIALECTS.filter((d) => d !== AUTHORED_DIALECT)
const CMD = 'export FOO=bar && echo "$FOO" | tr a-z A-Z'

const step = (over: Partial<ExportStep> = {}): ExportStep => ({
  n: 1,
  bid: 'b1',
  title: { en: 'Set the variable' },
  desc: { en: '' },
  command: CMD,
  level: 'required',
  why: { en: '' },
  subtasks: [],
  refs: [],
  ...over,
})

const list = (over: Partial<ExportList> = {}): ExportList => ({
  title: { en: 'Probe list' },
  desc: { en: '' },
  tags: [],
  ordered: true,
  version: 1,
  ownerHandle: 'probe',
  slug: 'probe',
  steps: [step()],
  ...over,
})

/**
 * Интерпретатор, которым можно РАЗОБРАТЬ вывод, если он есть на машине.
 *
 * Через файл, а не через stdin: `/dev/stdin` есть не везде (в Git Bash под Windows
 * его нет), и тест ложно падал бы на машине разработчика. Потолок времени — чтобы
 * отсутствующий интерпретатор не подвесил прогон вместо честного «нет такого».
 */
function parser(dialect: ScriptDialect): ((src: string) => void) | null {
  const PROBE_MS = 10_000
  const runFile = (cmd: string, args: (path: string) => string[]) => (src: string) => {
    const path = join(mkdtempSync(join(tmpdir(), 'sf-dialect-')), `probe.${dialectSpec(dialect).ext}`)
    writeFileSync(path, src)
    execFileSync(cmd, args(path), { stdio: ['ignore', 'ignore', 'pipe'], timeout: PROBE_MS })
  }
  const probe = (cmd: string, args: string[]) => {
    try {
      execFileSync(cmd, args, { stdio: 'ignore', timeout: PROBE_MS })
      return true
    } catch {
      return false
    }
  }
  // -n / py_compile разбирают исходник целиком, но НЕ исполняют его — ровно то, что нужно.
  if (dialect === 'sh' && probe('bash', ['-c', 'true'])) return runFile('bash', (p) => ['-n', p])
  if (dialect === 'py' && probe('python3', ['-c', 'pass'])) return runFile('python3', (p) => ['-m', 'py_compile', p])
  return null // pwsh на раннере нет — для ps1 остаётся структурная проверка ниже
}

describe('диалект не подсовывает авторские команды чужому интерпретатору', () => {
  it(`исполняемый выход объявлен ровно у одного диалекта (${AUTHORED_DIALECT})`, () => {
    expect(DIALECTS.filter(carriesCommands)).toEqual([AUTHORED_DIALECT])
  })

  for (const dialect of FOREIGN) {
    it(`${dialect}: список с исполняемой командой получает отказ, а не чужой скрипт`, () => {
      expect(scriptRefusal(list(), dialect)).toBe(DIALECT_CANNOT_CARRY)
    })

    it(`${dialect}: список без исполняемых команд отдаётся — обёртка честна на любом диалекте`, () => {
      const textOnly = list({ steps: [step({ command: '', type: 'text', content: { md: 'просто текст' } })] })
      expect(scriptRefusal(textOnly, dialect)).toBeNull()
    })

    it(`${dialect}: разрушительный пункт не повод для отказа — он и так закомментирован`, () => {
      const danger = list({ steps: [step({ command: 'rm -rf ./build', danger: true })] })
      expect(scriptRefusal(danger, dialect)).toBeNull()
    })

    it(`${dialect}: отказ считается по ВЫБОРКЕ пунктов, а не по всему списку`, () => {
      const mixed = list({
        steps: [step({ bid: 'runnable' }), step({ n: 2, bid: 'prose', command: '', type: 'text', content: { md: 'текст' } })],
      })
      expect(scriptRefusal(mixed, dialect, { only: ['prose'] })).toBeNull()
      expect(scriptRefusal(mixed, dialect, { only: ['runnable'] })).toBe(DIALECT_CANNOT_CARRY)
    })
  }

  it(`${AUTHORED_DIALECT} отдаётся всегда — фикс не убил саму фичу`, () => {
    expect(scriptRefusal(list(), AUTHORED_DIALECT)).toBeNull()
    expect(toRunnableScript(list(), 'en', 'https://example.test/probe/probe/raw', AUTHORED_DIALECT)).toContain(CMD)
  })
})

describe('заглушка отказа читается интерпретатором как «ничего не делать и упасть»', () => {
  for (const dialect of DIALECTS) {
    const body = errorScript(dialect, ['SetFork: refused', 'вторая строка причины'])

    it(`${dialect}: в теле только комментарии и ненулевой выход`, () => {
      const spec = dialectSpec(dialect)
      const lines = body.split(/\r\n|\r|\n/).filter((l) => l.trim())
      const last = lines.pop()
      expect(last).toBe(spec.fail)
      lines.forEach((l) => expect(l === spec.shebang || l.startsWith('#'), `исполняемая строка: ${l}`).toBe(true))
    })

    const parse = parser(dialect)
    it.skipIf(!parse)(`${dialect}: интерпретатор разбирает заглушку целиком`, () => {
      expect(() => parse!(body)).not.toThrow()
    })
  }
})

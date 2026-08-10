// Граница «данные vs код» в генераторе скрипта: НИ ОДНО текстовое поле списка не может
// начать новую строку скрипта. Разделителем строки интерпретаторы считают не только \n:
// python3 и PowerShell так же трактуют одиночный \r (проверено их парсерами), поэтому
// регулярка /\r?\n/ границу не держит — на этом были подтверждены две инъекции подряд.
import { describe, it, expect } from 'vitest'
import { toRunnableScript, type ExportList, type ExportStep } from '@/features/library/export'
import type { ScriptDialect } from '@/core/domain/script-dialect'

const DIALECTS: ScriptDialect[] = ['sh', 'ps1', 'py']
const SEPARATORS: Record<string, string> = { LF: '\n', CR: '\r', CRLF: '\r\n' }
const PWN = 'PWNED_MARKER'

const step = (over: Partial<ExportStep> = {}): ExportStep => ({
  n: 1,
  title: { en: 'Plain step' },
  desc: { en: '' },
  command: 'echo authored-command',
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

/** Строки вывода по ЛЮБОМУ терминатору, который признают целевые интерпретаторы. */
const lines = (out: string) => out.split(/\r\n|\r|\n/)

/** Полезная нагрузка, завершённая `#`: хвост декоративной рамки уходит в комментарий. */
const payload = (sep: string) => `Visible${sep}${PWN} #`

describe('данные не могут начать строку скрипта', () => {
  for (const [sepName, sep] of Object.entries(SEPARATORS)) {
    for (const dialect of DIALECTS) {
      const cases: [string, ExportList][] = [
        ['title шага', list({ steps: [step({ title: { en: payload(sep) } })] })],
        ['desc шага', list({ steps: [step({ desc: { en: payload(sep) } })] })],
        ['why шага', list({ steps: [step({ why: { en: payload(sep) } })] })],
        ['подзадача', list({ steps: [step({ command: '', subtasks: [{ en: payload(sep) }] })] })],
        ['заголовок списка', list({ title: { en: payload(sep) } })],
        ['описание списка', list({ desc: { en: payload(sep) } })],
        [
          'текстовый блок',
          list({
            steps: [step(), step({ n: 2, type: 'text', content: { md: payload(sep) }, command: '' })],
          }),
        ],
        [
          'подпись картинки',
          list({
            steps: [step(), step({ n: 2, type: 'image', content: { caption: payload(sep) }, command: '' })],
          }),
        ],
      ]

      for (const [field, l] of cases) {
        it(`${dialect} · ${sepName} в поле «${field}» не даёт исполняемой строки`, () => {
          const out = toRunnableScript(l, 'en', 'https://example.test/probe/probe/raw', dialect)
          const escaped = lines(out).filter((x) => x.trimStart().startsWith(PWN))
          expect(escaped).toEqual([])
        })
      }
    }
  }

  // Генератор диалект-агностичен: он одинаково соберёт скрипт для любого из трёх.
  // Кому из них МОЖНО отдать авторские команды — решает не он, а политика поверхности
  // (`scriptRefusal`, см. script-dialect.test.ts): здесь проверяется только то, что
  // экранирование полей не съело саму команду.
  it('авторская команда остаётся исполняемой (контроль, что фикс не убил фичу)', () => {
    for (const dialect of DIALECTS) {
      const out = toRunnableScript(list({ steps: [step({ command: 'echo authored-command' })] }), 'en', 'u', dialect)
      expect(lines(out)).toContain('echo authored-command')
    }
  })

  it('перевод строки в поле не склеивает слова, а остаётся видимым текстом', () => {
    const out = toRunnableScript(
      list({ steps: [step({ desc: { en: 'первая строка\nвторая строка' } })] }),
      'en',
      'u',
      'sh',
    )
    expect(out).toContain('первая строка')
    expect(out).toContain('вторая строка')
  })
})

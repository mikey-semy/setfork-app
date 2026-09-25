import { describe, expect, it } from 'vitest'
import { fileRefusalWarning, parseEditorFiles } from '@/features/library/editor-files'
import { authoredPathProblem } from '@/core/domain/authored-path'
import { contentRefusalFrom, secretWhere } from '@/shared/ui/ContentRefusalAlert'

// Поле `authored` формы редактора: «не трогали» и «убрали все» — разные вещи.
describe('parseEditorFiles', () => {
  it('поля нет или оно пустое — «не трогали», а не пустой набор', () => {
    expect(parseEditorFiles(null)).toBeUndefined()
    expect(parseEditorFiles('')).toBeUndefined()
  })

  it('пустой массив — «убрали все»', () => {
    expect(parseEditorFiles('[]')).toEqual([])
  })

  it('набор разбирается как есть', () => {
    const files = [{ path: 'scripts/run.sh', text: 'echo hi\n', executable: true }]
    expect(parseEditorFiles(JSON.stringify(files))).toEqual(files)
  })

  it.each([
    ['не JSON', '{'],
    ['не массив', '{"path":"scripts/a"}'],
    ['подпапка', JSON.stringify([{ path: 'scripts/sub/a.sh', text: '', executable: false }])],
    ['исполняемый вне scripts/', JSON.stringify([{ path: 'references/a.md', text: '', executable: true }])],
    ['дубль', JSON.stringify([1, 2].map(() => ({ path: 'assets/a.txt', text: '', executable: false })))],
    ['двоичное', JSON.stringify([{ path: 'assets/a.bin', text: 'a\u0000b', executable: false }])],
    ['нет поля', JSON.stringify([{ path: 'assets/a.txt', text: '' }])],
  ])('%s — отказ, а не молчаливый пропуск', (_name, raw) => {
    expect(parseEditorFiles(raw)).toBe('bad')
  })
})

describe('fileRefusalWarning', () => {
  it('скрипт судится по языку: Python — по командам исполнения', () => {
    expect(fileRefusalWarning([{ path: 'scripts/clean.py', text: 'import os\nos.system("rm -rf /")\n', executable: true }])).toEqual({ kind: 'destructive', path: 'scripts/clean.py' })
    // Та же строка в печати — не команда.
    expect(fileRefusalWarning([{ path: 'scripts/note.py', text: 'print("never run rm -rf /")\n', executable: true }])).toBeNull()
  })

  it('опасная строка вне scripts/ — не скрипт, её не исполняют', () => {
    expect(fileRefusalWarning([{ path: 'references/danger.md', text: 'rm -rf /\n', executable: false }])).toBeNull()
  })

  it('ключ ищется во всех файлах и называет путь', () => {
    // Образец собран из кусков: литерал ключа в тесте режет защита пушей GitHub.
    const key = ['ghp', '_', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5'].join('')
    const hit = fileRefusalWarning([{ path: 'references/setup.md', text: `token: ${key}\n`, executable: false }])
    expect(hit).toMatchObject({ kind: 'secret', path: 'references/setup.md' })
  })
})

describe('authoredPathProblem', () => {
  it.each([
    ['scripts/run.sh', true, null],
    ['references/guide.md', false, null],
    ['scripts/sub/run.sh', false, 'path'],
    ['other/a.txt', false, 'path'],
    ['scripts/..', false, 'path'],
    ['assets/.env', false, 'dot'],
    ['assets/a\\b', false, 'chars'],
    ['assets/a‮b', false, 'chars'],
    [`assets/${'я'.repeat(51)}`, false, 'long'],
    ['assets/run.sh', true, 'exec'],
  ] as const)('%s (exec %s) → %s', (path, exec, want) => {
    expect(authoredPathProblem(path, exec)).toBe(want)
  })
})

describe('отказ по файлу — место названо путём', () => {
  it('из адреса: file= переходит в отказ', () => {
    expect(contentRefusalFrom({ blocked: 'wipesFilesystem', step: '0', file: 'scripts/x.py' })).toEqual({ kind: 'destructive', reason: 'wipesFilesystem', step: '0', path: 'scripts/x.py' })
    expect(contentRefusalFrom({ secret: 'github-pat', step: '0' })).toEqual({ kind: 'secret', rule: 'github-pat', step: '0' })
  })

  it('«где» у ключа: файл важнее «названия и описания» при шаге 0', () => {
    expect(secretWhere('0', 'ru', 'references/a.md')).toBe('Файл references/a.md')
    expect(secretWhere('0', 'ru')).toBe('Название, описание или теги')
    expect(secretWhere('4', 'en')).toBe('Step 4')
  })
})

import { describe, it, expect } from 'vitest'
import { sanitizeCommand } from './sanitize-command'

describe('sanitizeCommand', () => {
  it('keeps real commands with args / paths / flags / operators', () => {
    expect(sanitizeCommand('npm install')).toBe('npm install')
    expect(sanitizeCommand('docker compose up -d')).toBe('docker compose up -d')
    expect(sanitizeCommand('git clone https://x/y.git')).toBe('git clone https://x/y.git')
    expect(sanitizeCommand('./configure')).toBe('./configure')
    expect(sanitizeCommand('cat a | grep b')).toBe('cat a | grep b')
  })

  it('keeps known single-word utilities', () => {
    expect(sanitizeCommand('ls')).toBe('ls')
    expect(sanitizeCommand('make')).toBe('make')
    expect(sanitizeCommand('GIT')).toBe('GIT') // case-insensitive allowlist
  })

  it('drops fake single-token "commands" (the sugar_syrup bug)', () => {
    expect(sanitizeCommand('sugar_syrup')).toBe('')
    expect(sanitizeCommand('gatherIngredients')).toBe('')
    expect(sanitizeCommand('whip')).toBe('')
  })

  it('trims and handles empty', () => {
    expect(sanitizeCommand('   ')).toBe('')
    expect(sanitizeCommand('')).toBe('')
    expect(sanitizeCommand('  ls  ')).toBe('ls')
  })
})

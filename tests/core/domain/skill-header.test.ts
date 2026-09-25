import { describe, expect, it } from 'vitest'
import { pickSkillHeader } from '@/core/domain/skill-header'

// Шапка исходного SKILL.md: что храним, что называем несохранённым. Молча не теряется ничего.
describe('pickSkillHeader', () => {
  it('поля спецификации — строками, metadata — строка → строка', () => {
    const { header, dropped } = pickSkillHeader({
      license: 'Apache-2.0',
      compatibility: 'Requires git and python3',
      'allowed-tools': 'Bash(git:*) Read',
      metadata: { author: 'Ann', version: 2, beta: true },
    })
    expect(header).toEqual({
      license: 'Apache-2.0',
      compatibility: 'Requires git and python3',
      'allowed-tools': 'Bash(git:*) Read',
      metadata: { author: 'Ann', version: '2', beta: 'true' },
    })
    expect(dropped).toEqual([])
  })

  it('наши setfork-* не храним — их экспорт пишет из живого списка', () => {
    const { header } = pickSkillHeader({ metadata: { 'setfork-ref': 'a/b', 'setfork-version': '3', owner: 'x' } })
    expect(header).toEqual({ metadata: { owner: 'x' } })
  })

  it('неизвестное и не той формы — в перечне несохранённого', () => {
    const { header, dropped } = pickSkillHeader({ license: { spdx: 'MIT' }, custom: 'x', metadata: { list: [1, 2] } })
    expect(header).toBeNull()
    expect(dropped.sort()).toEqual(['custom', 'license', 'metadata.list'])
  })

  it('пустая шапка — null, а не пустой объект в базе', () => {
    expect(pickSkillHeader({}).header).toBeNull()
    expect(pickSkillHeader({ metadata: { 'setfork-ref': 'a/b' } }).header).toBeNull()
  })

  it('allowed-tools списком — строкой через пробел, как в спецификации', () => {
    expect(pickSkillHeader({ 'allowed-tools': ['Bash(git:*)', 'Read'] }).header).toEqual({ 'allowed-tools': 'Bash(git:*) Read' })
  })
})

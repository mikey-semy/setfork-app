import { describe, expect, it } from 'vitest'
import { isMythicName, mythicName, mythicNames, needsOwnName } from '@/shared/ai/gnome-names'

// Имена специалистов: канон Двергатáля с привязкой к ремеслу + синтез из морфем.
// Покрытия у модуля не было вовсе, хотя от него зависит подпись автора списка.

describe('needsOwnName — кому ещё не давали имени', () => {
  it('роль в поле имени при пустой профессии', () => {
    expect(needsOwnName('Devops', '')).toBe(true)
  })

  it('профессия повторяет имя — то же самое состояние', () => {
    expect(needsOwnName('Chef', 'Chef')).toBe(true)
    expect(needsOwnName('Chef', ' chef ')).toBe(true)
  })

  it('мифологическое имя — уже своё, даже без профессии', () => {
    expect(needsOwnName('Brokkr', '')).toBe(false)
  })

  it('своё имя защищено заполненной профессией', () => {
    expect(needsOwnName('Gunnarr', 'Coach')).toBe(false)
  })

  it('пустое имя не переименовываем', () => {
    expect(needsOwnName('', 'Coach')).toBe(false)
  })
})

describe('mythicName', () => {
  it('канон выбирается по смыслу ремесла, а не случайно', () => {
    expect(mythicName('devops', 'Devops').name).toBe('Brokkr')
    expect(mythicName('tester', 'Tester').name).toBe('Þrár')
    expect(mythicName('chef', 'Chef').name).toBe('Fjalarr')
  })

  it('одно и то же id даёт одно и то же имя', () => {
    expect(mythicName('scholar', 'Scholar')).toEqual(mythicName('scholar', 'Scholar'))
  })

  it('занятое имя второй раз не выдаётся', () => {
    const taken = new Set(['Brokkr'])
    expect(mythicName('devops', 'Devops', taken).name).not.toBe('Brokkr')
  })

  it('канон конечен: когда он исчерпан, имена синтезируются из морфем', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `hire-${i}`, profession: `Craft ${i}` }))
    const all = Object.values(mythicNames(many))

    const synthesized = all.filter((n) => n.source === 'synthesized')
    expect(synthesized.length).toBeGreaterThan(0)
    expect(new Set(all.map((n) => n.name)).size).toBe(all.length)
  })

  it('канон получает кириллическую форму, синтезу кириллицу не выдумываем', () => {
    expect(mythicName('devops', 'Devops').nameRu).toBe('Броккр')
    const synth = Object.values(mythicNames(Array.from({ length: 60 }, (_, i) => ({ id: `s-${i}`, profession: '' })))).find((n) => n.source === 'synthesized')
    expect(synth?.nameRu).toBe(synth?.name)
  })

  it('состав целиком получает имена без повторов', () => {
    const roster = ['devops', 'coder', 'chef', 'coach', 'scholar', 'tester', 'security', 'dba'].map((id) => ({ id, profession: id }))
    const names = Object.values(mythicNames(roster)).map((n) => n.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('isMythicName', () => {
  it('узнаёт канон в обеих формах и не путает его с ролью', () => {
    expect(isMythicName('Brokkr')).toBe(true)
    expect(isMythicName('Броккр')).toBe(true)
    expect(isMythicName('Devops')).toBe(false)
  })
})

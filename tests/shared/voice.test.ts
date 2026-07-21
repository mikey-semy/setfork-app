import { describe, expect, it } from 'vitest'
import { VOICE, voiceLine, type VoiceKind } from '@/shared/ai/voice'

describe('voiceLine', () => {
  it('детерминирован: один (who, kind, lang, seed) → одна и та же реплика', () => {
    const a = voiceLine('chef', 'draft', 'ru', 'gen-1:1')
    const b = voiceLine('chef', 'draft', 'ru', 'gen-1:1')
    expect(a).toBe(b)
    expect(VOICE.chef.draft!.ru).toContain(a)
  })

  it('who разводит персонажей одного витка по разным индексам (хэш включает who)', () => {
    // Не требуем различия конкретной пары (может совпасть) — но на 8 экспертах
    // с одним seed должно быть >1 уникальной реплики, иначе хэш не работает.
    const seed = 'gen-2:1'
    const ids = ['devops', 'coder', 'chef', 'traveler', 'coach', 'scholar', 'hoarder', 'generalist']
    const lines = new Set(ids.map((id) => voiceLine(id, 'draft', 'ru', seed)))
    expect(lines.size).toBeGreaterThan(1)
  })

  it('подстановка переменных: {names} и {n}', () => {
    const line = voiceLine('crier', 'summon', 'ru', 's', { names: 'Повар, Кодер' })
    expect(line).toContain('Повар, Кодер')
    const seek = voiceLine('seek-lists', 'seek', 'en', 's', { n: '7' })
    expect(seek).toContain('7')
  })

  it('незнакомый who/kind → null (кастомный эксперт падает на нейтральный текст)', () => {
    expect(voiceLine('custom-expert', 'draft', 'ru', 's')).toBeNull()
    expect(voiceLine('chef', 'synth', 'ru', 's')).toBeNull()
  })

  it('у каждого набора есть строки в ОБОИХ языках (en пустой = молчание на .com)', () => {
    for (const [who, kinds] of Object.entries(VOICE)) {
      for (const [kind, set] of Object.entries(kinds)) {
        expect(set!.en.length, `${who}/${kind} en`).toBeGreaterThan(0)
        expect(set!.ru.length, `${who}/${kind} ru`).toBeGreaterThan(0)
      }
    }
  })

  it('все 8 SEED-экспертов имеют голос draft', () => {
    for (const id of ['devops', 'coder', 'chef', 'traveler', 'coach', 'scholar', 'hoarder', 'generalist'])
      expect(voiceLine(id, 'draft' as VoiceKind, 'ru', 's'), id).not.toBeNull()
  })
})

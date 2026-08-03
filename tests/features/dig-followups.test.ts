import { describe, expect, it } from 'vitest'
import { parseFollowups } from '@/features/dig/followups'
import { NEXT_TEMPLATE } from '@/shared/ai/reply-parse'

describe('parseFollowups (NEXT: не должен вылезать текстом)', () => {
  it('формат в строку через «|»', () => {
    const r = parseFollowups('Основной ответ.\nNEXT: почему так? | какие риски? | альтернатива?')
    expect(r.text).toBe('Основной ответ.')
    expect(r.followups).toEqual(['почему так?', 'какие риски?', 'альтернатива?'])
  })
  it('СПИСКОМ с новой строки и маркерами «-» (реальный кейс с прода)', () => {
    const raw = 'Команда gh pr create --fill…\n\nNEXT:\n- какие ещё команды можно использовать?\n- как проверить готовность PR к мержу?\n- что делать, если возникли конфликты?'
    const r = parseFollowups(raw)
    expect(r.text).toContain('gh pr create')
    expect(r.text).not.toContain('NEXT')
    expect(r.followups).toEqual([
      'какие ещё команды можно использовать?',
      'как проверить готовность PR к мержу?',
      'что делать, если возникли конфликты?',
    ])
  })
  it('маркеры «•», «*», «1.» и лишние пробелы срезаются', () => {
    const r = parseFollowups('Ответ.\nNEXT:\n1. первый\n• второй\n* третий')
    expect(r.followups).toEqual(['первый', 'второй', 'третий'])
  })
  it('нет NEXT → текст целиком, кнопок нет', () => {
    const r = parseFollowups('Просто ответ без хвоста.')
    expect(r.text).toBe('Просто ответ без хвоста.')
    expect(r.followups).toEqual([])
  })
  it('не более трёх', () => {
    const r = parseFollowups('X\nNEXT: a | b | c | d | e')
    expect(r.followups).toHaveLength(3)
  })
  it('модель скопировала шаблон промпта → кнопок нет (реальный кейс с прода)', () => {
    const r = parseFollowups('winget ставит VS Code воспроизводимо…\nNEXT: q1 | q2 | q3')
    expect(r.text).toContain('winget')
    expect(r.text).not.toContain('NEXT')
    expect(r.followups).toEqual([])
  })
  it('образец из промпта скопирован целиком → кнопок нет', () => {
    const r = parseFollowups(`Ответ.\n${NEXT_TEMPLATE}`)
    expect(r.followups).toEqual([])
  })
  it('живой вопрос ВНУТРИ скобок образца остаётся — скобки снимаются', () => {
    const r = parseFollowups('Ответ.\nNEXT: <Почему именно winget?> | <Как обновлять?> | <Что если нет PATH?>')
    expect(r.followups).toEqual(['Почему именно winget?', 'Как обновлять?', 'Что если нет PATH?'])
  })
  it('заготовки отсеиваются, живые вопросы остаются', () => {
    const r = parseFollowups('Ответ.\nNEXT: q1 | а если сеть отвалится? | <third question>')
    expect(r.followups).toEqual(['а если сеть отвалится?'])
  })
})

describe('parseSummon (реальный созыв гнома)', () => {
  it('вычленяет SUMMON: id и текст передачи', async () => {
    const { parseSummon } = await import('@/features/dig/followups')
    const r = parseSummon('Это по части девопса, зову коллегу.\nSUMMON: devops')
    expect(r.summonId).toBe('devops')
    expect(r.text).toBe('Это по части девопса, зову коллегу.')
  })
  it('id нормализуется в нижний регистр', async () => {
    const { parseSummon } = await import('@/features/dig/followups')
    expect(parseSummon('X\nSUMMON: DevOps').summonId).toBe('devops')
  })
  it('нет SUMMON → текст целиком, без id', async () => {
    const { parseSummon } = await import('@/features/dig/followups')
    const r = parseSummon('Обычный ответ.')
    expect(r.summonId).toBeUndefined()
    expect(r.text).toBe('Обычный ответ.')
  })
})

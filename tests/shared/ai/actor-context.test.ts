import { describe, expect, it } from 'vitest'
import { currentAiActor, runAsCompany } from '@/shared/ai/actor-context'

/**
 * ПРИЗНАК «КТО ПОЗВАЛ» БЕРЁТСЯ ИЗ КОНТЕКСТА, А НЕ ИЗ АРГУМЕНТА.
 *
 * Журнал расхода пишут больше тридцати мест. Пометить их по одному значило бы завести
 * тридцать одну возможность забыть — а сегодняшний разбор долга ровно про это: обязательный
 * шаг, живущий у вызывающих, однажды пропускается (так было с модерацией, тегами и
 * переиндексацией). Поэтому пометка ставится один раз, в диспетчере петель.
 *
 * Проверяется именно свойство контекста: он переживает `await` и не течёт наружу.
 */
describe('кто позвал модель', () => {
  it('вне петли — человек', () => {
    expect(currentAiActor()).toBe('user')
  })

  it('внутри работы компании — компания', async () => {
    await runAsCompany(async () => {
      expect(currentAiActor()).toBe('company')
    })
  })

  it('переживает await и вложенные вызовы', async () => {
    await runAsCompany(async () => {
      await new Promise((r) => setTimeout(r, 5))
      const deep = async () => currentAiActor()
      expect(await deep()).toBe('company')
    })
  })

  it('НЕ течёт наружу: после работы компании снова человек', async () => {
    await runAsCompany(async () => currentAiActor())
    expect(currentAiActor()).toBe('user')
  })

  it('соседний поток работы не заражается', async () => {
    const outside = new Promise<string>((resolve) => setTimeout(() => resolve(currentAiActor()), 10))
    await runAsCompany(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(await outside).toBe('user')
  })
})

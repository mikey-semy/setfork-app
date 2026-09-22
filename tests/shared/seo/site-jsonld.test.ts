import { describe, expect, it } from 'vitest'
import { howTo, organization, softwareApplication, webSite } from '@/shared/seo/jsonld'

/**
 * РАЗМЕТКА САЙТА И ИНСТРУКЦИИ.
 *
 * До 22.09.2026 у самого сайта не было разметки вовсе: она существовала только у
 * списков и профилей, а на главной `ld+json` не встречался ни разу. Важна она не ради
 * вида в выдаче — сайт без разметки не разбирается нейросетями, которые всё чаще и
 * есть выдача (аудит, работа 2).
 *
 * Проверяем не «поле на месте», а то, от чего разметка становится ВРЕДНОЙ: шаблон
 * поиска, ведущий в несуществующий адрес, и «шаг 1 из 12» там, где порядка нет.
 */
const SITE = 'https://setfork.com'

describe('разметка сайта', () => {
  it('организация называет себя и ведёт на сайт', () => {
    const o = organization()
    expect(o['@type']).toBe('Organization')
    expect(o.url).toBe(SITE)
  })

  it('поиск по сайту указывает на ЖИВОЙ маршрут /search?q=', () => {
    // ⚠️ Шаблон, ведущий в несуществующее место, ХУЖЕ отсутствующего: поисковик покажет
    // строку поиска в выдаче, а она приведёт человека в 404. Адрес здесь тот же, что у
    // строки поиска на главной (`HeroSearch` шлёт на `/search?q=`).
    const w = webSite() as { potentialAction: { target: { urlTemplate: string }; 'query-input': string } }
    expect(w.potentialAction.target.urlTemplate).toBe(`${SITE}/search?q={search_term_string}`)
    expect(w.potentialAction['query-input']).toContain('search_term_string')
  })

  it('продукт объявляет цену явно', () => {
    // Бесплатность не угадывают: без `offers` поисковик не знает, платный это продукт
    // или нет, и в карточку её не поставит.
    const a = softwareApplication() as { offers: { price: string; priceCurrency: string } }
    expect(a.offers.price).toBe('0')
    expect(a.offers.priceCurrency).toBe('USD')
  })
})

describe('инструкция из списка', () => {
  const steps = [
    { name: 'Поставить зависимости', text: 'npm ci' },
    { name: 'Прогнать тесты' },
    { name: 'Выкатить' },
  ]

  it('шаги нумеруются подряд и с единицы', () => {
    // Позиция — то, ради чего схема и берётся. Сбитая нумерация показывает человеку
    // «шаг 0» или два первых шага подряд.
    const h = howTo({ name: 'Выкатка', path: '/demo/deploy', steps }) as { step: { position: number; name: string }[] }
    expect(h.step.map((s) => s.position)).toEqual([1, 2, 3])
    expect(h.step[0].name).toBe('Поставить зависимости')
  })

  it('у каждого шага свой якорь на странице', () => {
    const h = howTo({ name: 'Выкатка', path: '/demo/deploy', steps }) as { step: { url: string }[] }
    expect(h.step.map((s) => s.url)).toEqual([
      `${SITE}/demo/deploy#1`,
      `${SITE}/demo/deploy#2`,
      `${SITE}/demo/deploy#3`,
    ])
  })

  it('шаг без пояснения не получает пустое поле text', () => {
    // Пустая строка в разметке — это утверждение «пояснение есть, и оно пустое».
    // Валидаторы на такое ругаются, а для читающей машины это мусор.
    const h = howTo({ name: 'Выкатка', path: '/demo/deploy', steps }) as { step: Record<string, unknown>[] }
    expect(h.step[1]).not.toHaveProperty('text')
    expect(h.step[0].text).toBe('npm ci')
  })

  it('адрес инструкции абсолютный', () => {
    // Относительный `url` в ld+json не разрешается: у машины нет базы, от которой считать.
    const h = howTo({ name: 'Выкатка', path: '/demo/deploy', steps }) as { url: string }
    expect(h.url).toBe(`${SITE}/demo/deploy`)
  })
})

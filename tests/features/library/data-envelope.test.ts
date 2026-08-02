import { describe, expect, it } from 'vitest'
import { DATA_KIND, dataEtag, toDataEnvelope } from '@/features/library/data-envelope'
import type { ExportList } from '@/features/library/export'

/**
 * Конверт данных — ПУБЛИЧНЫЙ КОНТРАКТ: его читают чужие программы. Тест держит форму, а не
 * содержимое: молча уехавшее поле здесь означает сломанный чужой код, а не «поправим потом».
 */
const LIST: ExportList = {
  title: { ru: 'Цены RU-моделей', en: 'RU model prices' },
  desc: { ru: 'Прайс без официального API', en: 'Pricing with no official API' },
  tags: ['llm', 'prices'],
  ordered: true,
  version: 7,
  ownerHandle: 'setfork',
  slug: 'ru-llm-prices',
  steps: [
    {
      n: 1,
      title: { ru: 'YandexGPT 5.1', en: 'YandexGPT 5.1' },
      desc: { ru: '800 ₽ за 1М', en: '800 RUB per 1M' },
      command: '',
      level: 'required',
      why: { ru: 'Источник — консоль', en: 'Source is the console' },
      subtasks: [{ ru: 'проверить НДС', en: 'check VAT' }],
      refs: [
        { label: { ru: 'Прайс', en: 'Pricing' }, url: 'https://yandex.cloud/prices' },
        { label: { ru: 'Без ссылки', en: 'No link' } }, // оформление, не источник
      ],
    },
    { n: 2, type: 'text', content: { md: 'Просто заметка' }, title: {}, desc: {}, command: '', level: 'required', why: {}, subtasks: [], refs: [] },
  ],
}

const AT = new Date('2026-08-01T10:00:00.000Z')

describe('toDataEnvelope: что видит чужой код', () => {
  const env = toDataEnvelope(LIST, 'ru', 'https://setfork.ru/setfork/ru-llm-prices', AT)

  it('несёт вид формата, ссылку, версию и отметку правки', () => {
    expect(env.kind).toBe(DATA_KIND)
    expect(env.ref).toBe('setfork/ru-llm-prices')
    expect(env.url).toBe('https://setfork.ru/setfork/ru-llm-prices')
    expect(env.version).toBe(7)
    // Свежесть — главный вопрос к справочнику: «когда цифру видели живой».
    expect(env.updatedAt).toBe('2026-08-01T10:00:00.000Z')
  })

  it('тексты сведены к ОДНОМУ языку — потребитель не должен знать про нашу мультиязычность', () => {
    expect(env.title).toBe('Цены RU-моделей')
    expect(env.steps[0].desc).toBe('800 ₽ за 1М')
    expect(env.steps[0].subtasks).toEqual(['проверить НДС'])
    expect(env.lang).toBe('ru')
    expect(toDataEnvelope(LIST, 'en', 'https://x', AT).title).toBe('RU model prices')
  })

  it('в данные едут только шаги: текст/картинка/опрос — оформление страницы', () => {
    expect(env.steps).toHaveLength(1)
    expect(env.steps[0].n).toBe(1)
  })

  it('ссылки без адреса отбрасываются — источник обязан быть адресом', () => {
    expect(env.steps[0].refs).toEqual([{ label: 'Прайс', url: 'https://yandex.cloud/prices' }])
  })
})

describe('dataEtag: кеш меняется ровно при изменении содержимого', () => {
  it('версия, время правки и язык входят в метку', () => {
    const base = dataEtag(7, AT, 'ru')
    expect(dataEtag(7, AT, 'ru')).toBe(base)
    expect(dataEtag(8, AT, 'ru')).not.toBe(base)
    expect(dataEtag(7, new Date(AT.getTime() + 1000), 'ru')).not.toBe(base)
    // Один и тот же список на двух языках — разные тела, значит и метки разные.
    expect(dataEtag(7, AT, 'en')).not.toBe(base)
  })
})

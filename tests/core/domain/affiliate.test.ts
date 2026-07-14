import { describe, expect, it } from 'vitest'
import {
  applyAffiliate,
  findAffiliateRule,
  hasAffiliateLink,
  hasMarkedAffiliate,
  hostMatches,
  markedAdvertisers,
  MAX_AFFILIATE_RULES,
  parseAffiliateRules,
  type AffiliateRule,
} from '@/core'

const RULES: AffiliateRule[] = [
  { match: 'amazon.com', param: 'tag', value: 'setfork-20' },
  { match: 'digitalocean.com', param: 'refcode', value: 'sf123' },
]

describe('parseAffiliateRules', () => {
  it('парсит валидные правила и нормализует хост', () => {
    const json = JSON.stringify([
      { match: 'WWW.Amazon.com ', param: ' tag ', value: ' setfork-20 ' },
      { match: '*.ebay.com', param: 'campid', value: 'x' },
    ])
    expect(parseAffiliateRules(json)).toEqual([
      { match: 'amazon.com', param: 'tag', value: 'setfork-20' },
      { match: 'ebay.com', param: 'campid', value: 'x' },
    ])
  })

  it('отбрасывает мусор: не-JSON, не-массив, кривые записи, хосты без точки/со слэшем', () => {
    expect(parseAffiliateRules('oops')).toEqual([])
    expect(parseAffiliateRules('{"a":1}')).toEqual([])
    const json = JSON.stringify([
      null,
      42,
      { match: 'amazon.com' }, // нет param/value
      { match: 'localhost', param: 'a', value: 'b' }, // хост без точки
      { match: 'evil.com/path', param: 'a', value: 'b' }, // слэш в match
      { match: 'ok.com', param: '', value: 'b' }, // пустой param
    ])
    expect(parseAffiliateRules(json)).toEqual([])
  })

  it('режет по лимиту', () => {
    const many = Array.from({ length: MAX_AFFILIATE_RULES + 10 }, (_, i) => ({ match: `site${i}.com`, param: 'r', value: 'v' }))
    expect(parseAffiliateRules(JSON.stringify(many))).toHaveLength(MAX_AFFILIATE_RULES)
  })
})

describe('hostMatches', () => {
  it('точное совпадение и поддомены — да; похожий домен — нет', () => {
    expect(hostMatches('amazon.com', 'amazon.com')).toBe(true)
    expect(hostMatches('www.amazon.com', 'amazon.com')).toBe(true)
    expect(hostMatches('smile.amazon.com', 'amazon.com')).toBe(true)
    expect(hostMatches('notamazon.com', 'amazon.com')).toBe(false)
    expect(hostMatches('amazon.com.evil.io', 'amazon.com')).toBe(false)
  })
})

describe('findAffiliateRule / applyAffiliate', () => {
  it('находит правило по хосту и подставляет параметр', () => {
    const r = applyAffiliate('https://www.amazon.com/dp/B0TEST?ref=xyz', RULES)
    expect(r.tagged).toBe(true)
    const u = new URL(r.url)
    expect(u.searchParams.get('tag')).toBe('setfork-20')
    expect(u.searchParams.get('ref')).toBe('xyz') // чужие параметры не трогаем
  })

  it('перезаписывает уже принесённый в ссылке тег', () => {
    const r = applyAffiliate('https://amazon.com/dp/B0TEST?tag=someone-else-21', RULES)
    expect(new URL(r.url).searchParams.get('tag')).toBe('setfork-20')
  })

  it('URL вне правил и невалидный URL — без изменений', () => {
    expect(applyAffiliate('https://example.com/x', RULES)).toEqual({ url: 'https://example.com/x', tagged: false, marked: false })
    expect(applyAffiliate('not a url', RULES)).toEqual({ url: 'not a url', tagged: false, marked: false })
    expect(findAffiliateRule('not a url', RULES)).toBeNull()
  })

  it('правило без erid: tagged, но marked=false', () => {
    const r = applyAffiliate('https://amazon.com/dp/B0', RULES)
    expect(r.tagged).toBe(true)
    expect(r.marked).toBe(false)
    expect(new URL(r.url).searchParams.has('erid')).toBe(false)
  })
})

describe('erid — РФ-маркировка (ЕРИР/ОРД)', () => {
  const ERID_RULES: AffiliateRule[] = [{ match: 'ozon.ru', param: 'partner', value: 'sf', erid: '2Vfnxw_A-1z' }]

  it('parseAffiliateRules принимает валидный erid', () => {
    const json = JSON.stringify([{ match: 'ozon.ru', param: 'partner', value: 'sf', erid: ' 2Vfnxw_A-1z ' }])
    expect(parseAffiliateRules(json)).toEqual([{ match: 'ozon.ru', param: 'partner', value: 'sf', erid: '2Vfnxw_A-1z' }])
  })

  it('невалидный erid отбрасывается, но правило остаётся', () => {
    const json = JSON.stringify([
      { match: 'ozon.ru', param: 'p', value: 'v', erid: 'bad token!' }, // пробел/восклицательный — не проходит
      { match: 'wildberries.ru', param: 'p', value: 'v', erid: 'x'.repeat(200) }, // слишком длинный
    ])
    expect(parseAffiliateRules(json)).toEqual([
      { match: 'ozon.ru', param: 'p', value: 'v' },
      { match: 'wildberries.ru', param: 'p', value: 'v' },
    ])
  })

  it('applyAffiliate кладёт erid в ссылку и помечает marked', () => {
    const r = applyAffiliate('https://www.ozon.ru/product/123?x=1', ERID_RULES)
    expect(r.tagged).toBe(true)
    expect(r.marked).toBe(true)
    const u = new URL(r.url)
    expect(u.searchParams.get('partner')).toBe('sf')
    expect(u.searchParams.get('erid')).toBe('2Vfnxw_A-1z')
    expect(u.searchParams.get('x')).toBe('1')
  })

  it('erid из правила перекрывает принесённый в ссылке', () => {
    const r = applyAffiliate('https://ozon.ru/p?erid=someone-else', ERID_RULES)
    expect(new URL(r.url).searchParams.get('erid')).toBe('2Vfnxw_A-1z')
  })

  it('hasMarkedAffiliate: только правила с erid триггерят пометку', () => {
    expect(hasMarkedAffiliate(['https://ozon.ru/p'], ERID_RULES)).toBe(true)
    expect(hasMarkedAffiliate(['https://amazon.com/x'], RULES)).toBe(false) // affiliate, но без erid
    expect(hasMarkedAffiliate(['https://example.com', undefined], ERID_RULES)).toBe(false)
    expect(hasMarkedAffiliate(['https://ozon.ru/p'], [])).toBe(false)
  })
})

describe('advertiser/ИНН — идентификация рекламодателя (ч. 16 ст. 18.1)', () => {
  it('parseAffiliateRules принимает наименование (схлопывает пробелы) и валидный ИНН', () => {
    const json = JSON.stringify([
      { match: 'ozon.ru', param: 'p', value: 'v', erid: 'ab12', advertiser: '  ООО   «Магазин»  ', advertiserInn: ' 7701234567 ' },
    ])
    expect(parseAffiliateRules(json)).toEqual([
      { match: 'ozon.ru', param: 'p', value: 'v', erid: 'ab12', advertiser: 'ООО «Магазин»', advertiserInn: '7701234567' },
    ])
  })

  it('принимает ИНН физлица/ИП (12 цифр), отбрасывает кривой ИНН но правило остаётся', () => {
    const json = JSON.stringify([
      { match: 'a.ru', param: 'p', value: 'v', erid: 'x', advertiser: 'ИП Иванов', advertiserInn: '771234567890' },
      { match: 'b.ru', param: 'p', value: 'v', erid: 'x', advertiser: 'X', advertiserInn: '12345' }, // не 10/12 цифр
      { match: 'c.ru', param: 'p', value: 'v', erid: 'x', advertiser: 'Y', advertiserInn: '77012345AB' }, // буквы
    ])
    expect(parseAffiliateRules(json)).toEqual([
      { match: 'a.ru', param: 'p', value: 'v', erid: 'x', advertiser: 'ИП Иванов', advertiserInn: '771234567890' },
      { match: 'b.ru', param: 'p', value: 'v', erid: 'x', advertiser: 'X' },
      { match: 'c.ru', param: 'p', value: 'v', erid: 'x', advertiser: 'Y' },
    ])
  })

  it('markedAdvertisers: уникальные рекламодатели помеченных ссылок, дедуп, порядок', () => {
    const rules: AffiliateRule[] = [
      { match: 'ozon.ru', param: 'p', value: 'v', erid: 'e1', advertiser: 'ООО «О»', advertiserInn: '7701234567' },
      { match: 'wb.ru', param: 'p', value: 'v', erid: 'e2', advertiser: 'ООО «В»' }, // без ИНН — всё равно называем
      { match: 'noerid.ru', param: 'p', value: 'v', advertiser: 'Не реклама' }, // без erid → игнор
    ]
    expect(
      markedAdvertisers(['https://ozon.ru/a', 'https://ozon.ru/b', 'https://wb.ru/x', 'https://noerid.ru/y'], rules),
    ).toEqual([
      { advertiser: 'ООО «О»', advertiserInn: '7701234567' },
      { advertiser: 'ООО «В»', advertiserInn: '' },
    ])
  })

  it('markedAdvertisers: erid без наименования — не попадает (нечего называть)', () => {
    const rules: AffiliateRule[] = [{ match: 'ozon.ru', param: 'p', value: 'v', erid: 'e1' }]
    expect(markedAdvertisers(['https://ozon.ru/a'], rules)).toEqual([])
  })
})

describe('hasAffiliateLink', () => {
  it('true, если хотя бы одна ссылка подпадает под правило', () => {
    expect(hasAffiliateLink(['https://example.com', 'https://m.digitalocean.com/droplets'], RULES)).toBe(true)
    expect(hasAffiliateLink(['https://example.com', undefined], RULES)).toBe(false)
    expect(hasAffiliateLink(['https://amazon.com/x'], [])).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { attributionLine, checkLicense, normalizeLicense } from '@/shared/ai/source-license'

// Лицензии источников — правило «только CC-BY/CC0/open-access» в виде кода. Тесты держат
// главное свойство: fail-closed. Неизвестная, пустая или невнятная лицензия = запрет, а
// NC/ND-варианты не должны проскакивать как обычный CC-BY (они запрещают ровно то, ради чего
// мы берём материал).

describe('нормализация того, что напишет человек', () => {
  it('разные написания CC-BY сводятся к одному коду', () => {
    for (const s of ['CC BY 4.0', 'cc-by-4.0', 'Creative Commons Attribution 4.0', 'CC-BY']) {
      expect(normalizeLicense(s)).toBe('CC-BY')
    }
  })

  it('CC0 и общественное достояние распознаются', () => {
    expect(normalizeLicense('CC0 1.0')).toBe('CC0')
    expect(normalizeLicense('public domain')).toBe('PUBLIC-DOMAIN')
  })

  it('ShareAlike не путается с обычным CC-BY', () => {
    expect(normalizeLicense('CC BY-SA 4.0')).toBe('CC-BY-SA')
  })

  it('NC и ND — запрет, а не «почти CC-BY»', () => {
    expect(normalizeLicense('CC BY-NC 4.0')).toBeNull()
    expect(normalizeLicense('CC BY-ND')).toBeNull()
    expect(normalizeLicense('CC BY-NC-SA 4.0')).toBeNull()
  })

  it('пусто и невнятное — null', () => {
    for (const s of ['', '   ', 'free to use', 'всё можно', 'proprietary']) expect(normalizeLicense(s)).toBeNull()
  })

  it('лицензии кода — для фрагментов', () => {
    expect(normalizeLicense('MIT')).toBe('MIT')
    expect(normalizeLicense('Apache License 2.0')).toBe('APACHE-2.0')
  })
})

describe('решение «можно ли брать»', () => {
  it('без лицензии — нельзя, и сказано прямо', () => {
    const v = checkLicense('')
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('не указана')
  })

  it('чужая лицензия — нельзя, с перечислением допустимых', () => {
    const v = checkLicense('All rights reserved')
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('CC0')
  })

  it('CC-BY без атрибуции — нельзя: это нарушение лицензии со ссылкой на неё', () => {
    expect(checkLicense('CC BY 4.0').ok).toBe(false)
    expect(checkLicense('CC BY 4.0', 'Иван Петров').ok).toBe(true)
  })

  it('CC0 атрибуции не требует', () => {
    expect(checkLicense('CC0').ok).toBe(true)
  })
})

describe('строка атрибуции', () => {
  it('собирается из автора, лицензии и адреса', () => {
    expect(attributionLine('CC-BY', 'Иван Петров', 'https://example.com/a')).toBe('Иван Петров · CC-BY · https://example.com/a')
  })

  it('для CC0 пустая — приписывать некому', () => {
    expect(attributionLine('CC0', '', 'https://example.com/a')).toBe('')
  })
})

describe('лицензия с довеском не превращается в чистую', () => {
  // «MIT License with Commons Clause» — это НЕ MIT: довесок запрещает продажу.
  // Раньше семейство определялось префиксом, и ограничение исчезало при нормализации,
  // а материал попадал в корпус как свободный.
  it.each([
    'MIT License with Commons Clause',
    'MIT modified',
    'Apache-2.0 with LLVM exception',
    'CC BY 4.0 with additional terms',
    'CC0 with reservations',
  ])('«%s» — отказ, а не опознание семейства', (raw) => {
    expect(checkLicense(raw, 'Иван Петров').ok).toBe(false)
  })

  it('обычные записи тех же лицензий по-прежнему проходят', () => {
    expect(checkLicense('MIT', 'Иван Петров').ok).toBe(true)
    expect(checkLicense('MIT License', 'Иван Петров').ok).toBe(true)
    expect(checkLicense('Apache License 2.0', 'Иван Петров').ok).toBe(true)
    expect(checkLicense('CC BY 4.0', 'Иван Петров').ok).toBe(true)
    expect(checkLicense('CC BY-SA 4.0 International', 'Иван Петров').ok).toBe(true)
    expect(checkLicense('CC0 1.0 Universal').ok).toBe(true)
  })
})

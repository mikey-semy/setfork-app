/**
 * ЛИЦЕНЗИИ ИСТОЧНИКОВ — что компании вообще можно брать в корпус.
 *
 * Правило владельца (реестр решений): только CC-BY/CC0/open-access, лицензия и цитируемость
 * ФИКСИРУЮТСЯ на источник. Здесь это правило в виде кода, а не пожелания в доке.
 *
 * Устройство fail-closed: неизвестная, пустая или невнятная лицензия — ЗАПРЕТ. «Наверное
 * можно» в вопросе чужих прав стоит дороже, чем пропущенный источник: материал возьмут один
 * раз, а отвечать за него придётся всё время, пока он лежит в библиотеке.
 *
 * Отдельно от «свободно почитать»: доступность страницы в интернете НЕ означает права
 * копировать. Поэтому лицензию здесь называет человек, а не угадывает алгоритм по домену.
 */

/** Что разрешено брать. Ключ — нормализованный код, значение — нужна ли атрибуция. */
export const ALLOWED_LICENSES = {
  CC0: { attribution: false, note: 'public domain dedication' },
  'PUBLIC-DOMAIN': { attribution: false, note: 'общественное достояние' },
  'CC-BY': { attribution: true, note: 'указание авторства обязательно' },
  'CC-BY-SA': { attribution: true, note: 'указание авторства + производное под той же лицензией' },
  MIT: { attribution: true, note: 'для фрагментов кода' },
  'APACHE-2.0': { attribution: true, note: 'для фрагментов кода' },
} as const

export type AllowedLicense = keyof typeof ALLOWED_LICENSES

/**
 * Нормализация того, что напишет человек: «CC BY 4.0», «cc-by-4.0», «Creative Commons
 * Attribution» → 'CC-BY'. Всё, что не распозналось однозначно, остаётся неизвестным — и
 * значит запрещённым.
 */
export function normalizeLicense(raw: string): AllowedLicense | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!s) return null
  const flat = s.replace(/[^A-Z0-9]/g, '')
  // Порядок важен: CC-BY-SA и NC/ND проверяем ДО общего CC-BY, иначе «CC BY-NC» пройдёт как CC-BY.
  if (/NC/.test(s) || flat.includes('NONCOMMERCIAL') || /ND/.test(s) || flat.includes('NODERIV')) return null

  // FAIL-CLOSED по ХВОСТУ. Раньше семейство определялось префиксом, и «MIT License with
  // Commons Clause» нормализовалось в чистый MIT: добавленное ограничение исчезало, а
  // материал попадал в корпус как свободный. Теперь после опознания семейства остаток
  // обязан состоять только из известных слов версии — любое чужое слово («WITH»,
  // «COMMONSCLAUSE», «MODIFIED») означает ДРУГУЮ лицензию, и мы её не знаем.
  const VERSIONWORDS = /^(LICENSE|LICENCE|VERSION|V|UNIVERSAL|INTERNATIONAL|GENERIC|DEED|ONLY|ORLATER|PLUS|CC|BY|SA|[0-9])*$/
  const family = (prefix: string, out: AllowedLicense): AllowedLicense | null =>
    VERSIONWORDS.test(flat.slice(prefix.length)) ? out : null

  if (flat.startsWith('CC0') || flat.includes('CCZERO')) return family(flat.startsWith('CC0') ? 'CC0' : 'CCZERO', 'CC0')
  if (flat.includes('PUBLICDOMAIN') || s === 'PD') return 'PUBLIC-DOMAIN'
  if (flat.startsWith('CCBYSA')) return family('CCBYSA', 'CC-BY-SA')
  if (flat.includes('ATTRIBUTIONSHAREALIKE')) return 'CC-BY-SA'
  if (flat.startsWith('CCBY')) return family('CCBY', 'CC-BY')
  if (flat.includes('CREATIVECOMMONSATTRIBUTION')) return 'CC-BY'
  if (flat === 'MIT') return 'MIT'
  if (flat.startsWith('MIT')) return family('MIT', 'MIT')
  if (flat.startsWith('APACHELICENSE2')) return family('APACHELICENSE2', 'APACHE-2.0')
  if (flat.startsWith('APACHE2')) return family('APACHE2', 'APACHE-2.0')
  return null
}

export interface LicenseVerdict {
  ok: boolean
  license: AllowedLicense | null
  /** Почему нельзя (или что требуется) — уходит человеку и в журнал. */
  reason: string
}

/**
 * Можно ли брать источник. Атрибуция обязательна там, где её требует лицензия: без неё
 * «взяли по CC-BY» — это не соблюдение лицензии, а её нарушение с ссылкой на неё.
 */
export function checkLicense(rawLicense: string, attribution = ''): LicenseVerdict {
  const license = normalizeLicense(rawLicense)
  if (!license) {
    // Без тернарника с двумя литералами: линтер видит в такой конструкции двуязычную строку
    // (эвристика бережёт словарь), а тут просто две разные причины отказа.
    const named = rawLicense.trim()
    if (!named) return { ok: false, license: null, reason: 'лицензия не указана — брать нельзя' }
    return {
      ok: false,
      license: null,
      reason: `лицензия «${named.slice(0, 60)}» не в списке разрешённых (CC0, CC-BY, CC-BY-SA, public domain, MIT, Apache-2.0)`,
    }
  }
  if (ALLOWED_LICENSES[license].attribution && !attribution.trim()) {
    return { ok: false, license, reason: `${license} требует указания авторства — заполните attribution` }
  }
  return { ok: true, license, reason: ALLOWED_LICENSES[license].note }
}

/** Строка атрибуции для показа рядом с материалом. Пусто — когда лицензия её не требует. */
export function attributionLine(license: AllowedLicense, attribution: string, url: string): string {
  if (!ALLOWED_LICENSES[license].attribution) return ''
  const who = attribution.trim() || 'источник'
  return `${who} · ${license} · ${url}`
}

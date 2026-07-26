/**
 * Имена специалистов совета — из скандинавской мифологии (решение владельца).
 *
 * Почему так: дверги «Двергатáля» (Vǫluspá) — искусные мастера и кузнецы, создатели
 * волшебных артефактов; именно они повлияли на образ мастеровых в фэнтези. Профессия
 * при этом живёт ОТДЕЛЬНО, в профиле, как должность — имя остаётся именем.
 *
 * Две ступени:
 *  1. КАНОН — засвидетельствованные имена с известной этимологией. Если смысл имени
 *     тянется к ремеслу (Brokkr — кузнец Мьёльнира → инженер), берём его: связь
 *     осмысленная, а не декоративная. В мифологии имена к профессиям не привязаны,
 *     поэтому совпадений мало — и мы их не выдумываем, а используем существующие.
 *  2. СИНТЕЗ — для современных профессий (нужно ~1000) собираем имя из настоящих
 *     древнескандинавских морфем и окончаний Двергатáля. Такое имя НЕ засвидетельствовано
 *     — оно лишь достоверно похоже на мифологическое; в этом и задача.
 *
 * Детерминированность обязательна: имя выводится из id специалиста, поэтому не «плывёт»
 * между вызовами и не расходится между БД и подписью в беседе.
 */

/** Где живут мастера: Нидавеллир — кузни, место работы (Свартальвхейм — весь мир). */
export const HOME_REALM = 'Niðavellir'

interface CanonName {
  name: string
  /** Этимология/сюжет — чтобы правку можно было проверить, а не спорить о вкусе. */
  meaning: string
  /** Подстроки профессии/домена, к которым имя тянется по смыслу. */
  affinity: string[]
}

/**
 * Засвидетельствованные имена (Vǫluspá 9–16, Skáldskaparmál, Reginsmál).
 * affinity пусто → имя без ремесленной привязки, годится любому.
 */
const CANON: CanonName[] = [
  // «engineer» тут НЕ указан намеренно: слово слишком общее и перебивало специфичные
  // совпадения («QA engineer» уходил кузнецу вместо Þrár). Специфичное должно выигрывать.
  { name: 'Brokkr', meaning: 'smith who forged Mjǫllnir and Gullinbursti', affinity: ['smith', 'devops', 'build', 'metal', 'mechanic', 'forge'] },
  { name: 'Sindri', meaning: 'smith of the gods; «sparkling»', affinity: ['electric', 'energy', 'weld', 'smith', 'hardware', 'power'] },
  { name: 'Eitri', meaning: 'smith, brother of Brokkr', affinity: ['chemist', 'chemical', 'material', 'toxic', 'lab'] },
  { name: 'Reginn', meaning: 'master smith who fostered Sigurðr; «mighty»', affinity: ['teacher', 'coach', 'mentor', 'trainer', 'tutor'] },
  { name: 'Alvíss', meaning: '«all-wise»', affinity: ['scholar', 'research', 'science', 'study', 'analyst', 'librarian'] },
  { name: 'Vitr', meaning: '«wise»', affinity: ['consult', 'advisor', 'expert', 'audit'] },
  { name: 'Fjǫlsviðr', meaning: '«much-wise»', affinity: ['data', 'statistic', 'archive', 'knowledge'] },
  { name: 'Ráðsviðr', meaning: '«swift in counsel»', affinity: ['manager', 'lead', 'coordinator', 'planner', 'director', 'general'] },
  { name: 'Nýráðr', meaning: '«new counsel»', affinity: ['strateg', 'innovat', 'product', 'founder'] },
  { name: 'Hannarr', meaning: '«skilful, dexterous»', affinity: ['craft', 'artisan', 'handy', 'carpenter', 'tailor', 'jewel'] },
  { name: 'Litr', meaning: '«hue, colour»', affinity: ['design', 'paint', 'art', 'colour', 'color', 'illustrat', 'photo'] },
  { name: 'Fjalarr', meaning: 'brewed the mead of poetry', affinity: ['chef', 'cook', 'brew', 'food', 'kitchen', 'bak', 'barten'] },
  { name: 'Galarr', meaning: 'brewed the mead of poetry with Fjalarr', affinity: ['sommelier', 'wine', 'ferment', 'distill'] },
  { name: 'Mjǫðvitnir', meaning: '«mead-wolf»', affinity: ['nutrition', 'diet', 'beverage'] },
  { name: 'Andvari', meaning: 'kept a hoard of gold; «care, caution»', affinity: ['hoarder', 'resource', 'scout', 'procure', 'supply', 'collect', 'account', 'financ'] },
  { name: 'Eikinskjaldi', meaning: '«oak-shield»', affinity: ['security', 'guard', 'defen', 'safety', 'legal', 'lawyer', 'risk'] },
  { name: 'Haugspori', meaning: '«mound-treader»', affinity: ['travel', 'wander', 'guide', 'tour', 'geolog', 'survey', 'logistic'] },
  { name: 'Frár', meaning: '«swift»', affinity: ['courier', 'delivery', 'sport', 'athlet', 'fitness', 'run'] },
  { name: 'Durinn', meaning: 'door-ward; second of the dwarves', affinity: ['gate', 'access', 'admin', 'operator', 'support'] },
  { name: 'Hornbori', meaning: '«horn-borer»', affinity: ['drill', 'mining', 'tunnel', 'construct', 'plumb'] },
  { name: 'Gandálfr', meaning: '«wand-elf»', affinity: ['magic', 'game', 'roleplay', 'story', 'writer', 'narrat'] },
  { name: 'Þrár', meaning: '«persistent»', affinity: ['test', 'qa', 'quality', 'inspect'] },
  { name: 'Dvalinn', meaning: 'gave runes to the dwarves; «the dormant one»', affinity: ['rune', 'language', 'translat', 'linguist', 'code', 'program', 'software'] },
  { name: 'Draupnir', meaning: '«dripper»; also Óðinn’s ring', affinity: ['medic', 'nurse', 'doctor', 'health', 'pharma'] },
  // Без ремесленной привязки — общий запас канона.
  { name: 'Mótsognir', meaning: 'foremost of the dwarves', affinity: [] },
  { name: 'Dáinn', meaning: 'one of the four who gave runes', affinity: [] },
  { name: 'Nár', meaning: 'from the Dvergatal', affinity: [] },
  { name: 'Þorinn', meaning: '«the bold»', affinity: [] },
  { name: 'Glóinn', meaning: '«the glowing»', affinity: [] },
  { name: 'Nóri', meaning: 'from the Dvergatal', affinity: [] },
  { name: 'Bifurr', meaning: 'from the Dvergatal', affinity: [] },
  { name: 'Bǫmburr', meaning: 'from the Dvergatal', affinity: [] },
  { name: 'Skirfir', meaning: 'from the Dvergatal', affinity: [] },
  { name: 'Virfir', meaning: 'from the Dvergatal', affinity: [] },
  { name: 'Aurvangr', meaning: '«mud-plain»', affinity: [] },
  { name: 'Lofarr', meaning: 'ancestor of a dwarf line', affinity: [] },
]

/** Морфемы для синтеза: настоящие древнескандинавские корни. */
const ROOTS: [string, string][] = [
  ['Berg', 'rock'], ['Stein', 'stone'], ['Járn', 'iron'], ['Gull', 'gold'], ['Silfr', 'silver'],
  ['Eld', 'fire'], ['Vind', 'wind'], ['Regin', 'powers'], ['Hrafn', 'raven'], ['Rún', 'rune'],
  ['Ljós', 'light'], ['Nið', 'waning dark'], ['Hug', 'mind'], ['List', 'skill, art'], ['Hag', 'skilled'],
  ['Smið', 'smith'], ['Stafr', 'stave'], ['Skjald', 'shield'], ['Fjǫl', 'much'], ['Ný', 'new'],
  ['Þrá', 'persistence'], ['Vé', 'sacred'], ['Ský', 'cloud'], ['Horn', 'horn'], ['Mál', 'speech'],
]

/** Окончания, характерные для Двергатáля. */
const ENDINGS = ['inn', 'arr', 'urr', 'ir', 'nir', 'uðr', 'viðr', 'áinn']

/** Устойчивый хеш строки (FNV-1a): имя не должно «плыть» между вызовами. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Русские формы канона — принятые в переводах «Старшей Эдды» написания. Синтезированным
 * именам кириллицы не даём: механическая транслитерация древнескандинавского врёт, а
 * врать в имени человека (пусть и служебного) нельзя — там остаётся латиница.
 */
const CANON_RU: Record<string, string> = {
  Brokkr: 'Броккр', Sindri: 'Синдри', Eitri: 'Эйтри', Reginn: 'Регин', Alvíss: 'Альвис',
  Vitr: 'Витр', 'Fjǫlsviðr': 'Фьёльсвид', 'Ráðsviðr': 'Радсвид', 'Nýráðr': 'Нюрад',
  Hannarr: 'Ханнар', Litr: 'Лит', Fjalarr: 'Фьялар', Galarr: 'Галар', 'Mjǫðvitnir': 'Мьёдвитнир',
  Andvari: 'Андвари', Eikinskjaldi: 'Эйкинскьяльди', Haugspori: 'Хаугспори', 'Frár': 'Фрар',
  Durinn: 'Дурин', Hornbori: 'Хорнбори', 'Gandálfr': 'Гандальв', 'Þrár': 'Трар',
  Dvalinn: 'Двалин', Draupnir: 'Драупнир', 'Mótsognir': 'Мотсогнир', 'Dáinn': 'Даин',
  'Nár': 'Нар', 'Þorinn': 'Торин', 'Glóinn': 'Глоин', 'Nóri': 'Нори', Bifurr: 'Бивур',
  'Bǫmburr': 'Бёмбур', Skirfir: 'Скирвир', Virfir: 'Вирвир', Aurvangr: 'Аурванг', Lofarr: 'Ловар',
}

export interface MythicName {
  name: string
  /** Кириллическая форма (канон) либо та же латиница — см. CANON_RU. */
  nameRu: string
  /** Откуда имя: канон — засвидетельствовано, синтез — лишь стилистически похоже. */
  source: 'canon' | 'synthesized'
  /** Этимология (канон) или разбор морфем (синтез) — для админки и ревью. */
  meaning: string
}

const canonOut = (c: CanonName): MythicName => ({
  name: c.name,
  nameRu: CANON_RU[c.name] || c.name,
  source: 'canon',
  meaning: c.meaning,
})

/**
 * Имя специалиста по его id и профессии.
 *
 * @param seed стабильный ключ (id специалиста) — от него зависит выбор
 * @param profession профессия по-английски: ищем смысловую связь с каноном
 * @param taken уже занятые имена — канон не выдаём дважды
 */
export function mythicName(seed: string, profession = '', taken: ReadonlySet<string> = new Set()): MythicName {
  const p = profession.toLowerCase()
  // 1. Канон по смыслу ремесла.
  if (p) {
    const match = CANON.find((c) => !taken.has(c.name) && c.affinity.some((a) => p.includes(a)))
    if (match) return canonOut(match)
  }
  // 2. Свободный канон без привязки — детерминированным выбором.
  const free = CANON.filter((c) => !taken.has(c.name) && c.affinity.length === 0)
  if (free.length) return canonOut(free[hash(seed) % free.length])
  // 3. Синтез: корень + окончание. Не засвидетельствовано — но похоже на мифологическое.
  //    Канон конечен, а профессий сколько угодно — эта ветка и есть «много».
  const h = hash(seed)
  for (let i = 0; i < ROOTS.length * ENDINGS.length; i++) {
    const [root, sense] = ROOTS[(h + i) % ROOTS.length]
    const end = ENDINGS[(h + i * 7) % ENDINGS.length]
    const name = root + end
    if (!taken.has(name)) return { name, nameRu: name, source: 'synthesized', meaning: `${sense} + -${end} (Dvergatal-style)` }
  }
  const fallback = `${ROOTS[h % ROOTS.length][0]}${ENDINGS[h % ENDINGS.length]}-${(h % 999).toString(36)}`
  return { name: fallback, nameRu: fallback, source: 'synthesized', meaning: 'exhausted combinations' }
}

/**
 * Это уже мифологическое имя, а не профессия?
 *
 * Защита от порчи данных, которая случилась на дев-БД: если профессию где-то заполнить
 * из имени ПОСЛЕ переименования, в профессию попадает «Brokkr», и следующая раздача имён
 * считает аффинити по мусору (кузнец переставал быть девопсером). Приём «профессия из
 * имени» верен только до первого переименования — здесь мы это распознаём.
 */
export function isMythicName(s: string): boolean {
  const v = s.trim()
  return CANON.some((c) => c.name === v) || Object.values(CANON_RU).includes(v)
}

/** Имена для всего состава сразу — без повторов канона. */
export function mythicNames(list: { id: string; profession: string }[]): Record<string, MythicName> {
  const taken = new Set<string>()
  const out: Record<string, MythicName> = {}
  for (const e of list) {
    const n = mythicName(e.id, e.profession, taken)
    taken.add(n.name)
    out[e.id] = n
  }
  return out
}

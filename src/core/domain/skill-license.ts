/**
 * ЛИЦЕНЗИЯ ИМПОРТИРУЕМОГО СКИЛЛА — можно ли его публиковать.
 *
 * Решение владельца 25.09.2026: чужой скилл импортируется всегда, но видимость следует
 * лицензии. Открытая (разрешает распространение) — список может быть публичным, с указанием
 * автора; лицензии нет, она закрытая или неясная — только приватный.
 *
 * Как у GitHub (licensee): лицензия узнаётся по SPDX-идентификатору (`license: MIT` в
 * шапке SKILL.md) или по тексту LICENSE-файла — по фразам, которые есть только в тексте
 * этой лицензии. Чего не узнали — то закрытое: ошибка в сторону «приватно» обратима
 * автором, ошибка в сторону «публично» — это чужое, выложенное без права.
 *
 * Некоммерческие и «без производных» варианты Creative Commons (NC, ND) — закрытые: список
 * на сайте — распространение, и сайт не обещает, что оно некоммерческое.
 */

/** SPDX-идентификаторы, разрешающие распространение и изменение. */
const OPEN_SPDX = new Set(
  [
    'MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'ISC', 'MPL-2.0',
    'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later',
    'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later',
    'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'EPL-2.0', 'Unlicense', 'CC0-1.0',
    'CC-BY-4.0', 'CC-BY-SA-4.0', 'Zlib', 'BSL-1.0', 'Python-2.0', 'Artistic-2.0',
  ].map((s) => s.toLowerCase()),
)

/** Фразы из текста лицензии → её идентификатор. Порядок: более узкие раньше. */
const TEXT_SIGNATURES: [RegExp, string][] = [
  [/GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/i, 'AGPL-3.0'],
  [/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i, 'LGPL-3.0'],
  [/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/i, 'LGPL-2.1'],
  [/GNU GENERAL PUBLIC LICENSE\s+Version 3/i, 'GPL-3.0'],
  [/GNU GENERAL PUBLIC LICENSE\s+Version 2/i, 'GPL-2.0'],
  [/Apache License\s+Version 2\.0/i, 'Apache-2.0'],
  [/Mozilla Public License,?\s+(?:Version|v\.?)\s*2\.0/i, 'MPL-2.0'],
  [/This is free and unencumbered software released into the public domain/i, 'Unlicense'],
  [/CC0 1\.0 Universal/i, 'CC0-1.0'],
  [/Attribution-ShareAlike 4\.0 International/i, 'CC-BY-SA-4.0'],
  [/Attribution 4\.0 International/i, 'CC-BY-4.0'],
  [/Boost Software License - Version 1\.0/i, 'BSL-1.0'],
  [/Permission is hereby granted, free of charge, to any person obtaining a copy/i, 'MIT'],
  [/Permission to use, copy, modify, and\/or distribute this software for any purpose/i, 'ISC'],
  [/Redistribution and use in source and binary forms, with or without\s+modification, are permitted/i, 'BSD'],
]

/** Слова, при которых «открытость» не угадываем, даже если рядом стоит знакомый текст. */
const CLOSED_WORDS = /proprietary|all rights reserved|without a license|no license|non-?commercial|noderivatives|\bCC-BY-NC|\bCC-BY-ND/i

export interface SkillLicense {
  /** Что узнали: SPDX-идентификатор (или «BSD» по тексту), сырое значение шапки, либо null. */
  id: string | null
  /** Разрешает ли распространение — можно ли списку быть публичным. */
  open: boolean
  /** Откуда вывод: поле шапки, текст LICENSE или ничего. */
  from: 'header' | 'file' | 'none'
}

/** SPDX-выражение из шапки: `MIT`, `MIT OR Apache-2.0`, `(Apache-2.0 AND MIT)`. */
function spdxOpen(expr: string): boolean | null {
  const clean = expr.replace(/[()]/g, ' ').trim()
  if (!/^[A-Za-z0-9.+\-\s]+$/.test(clean)) return null
  const ors = clean.split(/\s+OR\s+/i)
  const verdicts = ors.map((alt) => {
    const ids = alt.split(/\s+AND\s+/i).map((s) => s.trim().replace(/\+$/, '').toLowerCase())
    if (ids.some((id) => !/^[a-z0-9.\-]+$/.test(id))) return null
    return ids.every((id) => OPEN_SPDX.has(id))
  })
  if (verdicts.some((v) => v === null)) return null
  return verdicts.some(Boolean)
}

/** Текст LICENSE → идентификатор или null. */
export function licenseFromText(text: string): string | null {
  return TEXT_SIGNATURES.find(([re]) => re.test(text))?.[1] ?? null
}

/**
 * Вердикт по шапке и тексту LICENSE. Шапка — первой: это заявление автора скилла. Не
 * SPDX-выражение (например «Proprietary. LICENSE.txt has complete terms») — решает текст
 * файла, но слова «proprietary», «all rights reserved» и подобные закрывают список сразу.
 */
export function classifySkillLicense(header: string | undefined, licenseText: string | null): SkillLicense {
  const h = header?.trim() ?? ''
  if (h && CLOSED_WORDS.test(h)) return { id: h, open: false, from: 'header' }
  if (h) {
    const open = spdxOpen(h)
    if (open !== null) return { id: h, open, from: 'header' }
  }
  if (licenseText) {
    if (CLOSED_WORDS.test(licenseText.slice(0, 2000)) && !licenseFromText(licenseText)) return { id: null, open: false, from: 'file' }
    const id = licenseFromText(licenseText)
    if (id) return { id, open: true, from: 'file' }
    return { id: null, open: false, from: 'file' }
  }
  return { id: h || null, open: false, from: h ? 'header' : 'none' }
}

/**
 * Может ли список быть публичным. Единственное правило на все пути: настройки видимости,
 * копии (шаблон, форк) и то, что показывает интерфейс. `false` — импорт без открытой
 * лицензии; null/true — список не импортирован или лицензия открытая.
 */
export const canBePublic = (tpl: { sourceLicenseOpen?: boolean | null }): boolean => tpl.sourceLicenseOpen !== false

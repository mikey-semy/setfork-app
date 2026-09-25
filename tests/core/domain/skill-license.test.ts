import { describe, expect, it } from 'vitest'
import { canBePublic, classifySkillLicense, licenseFromText } from '@/core/domain/skill-license'

// Видимость импортированного скилла следует лицензии (решение владельца 25.09.2026).
// Неузнанное — закрытое: ошибка в сторону «приватно» обратима, в сторону «публично» — нет.
describe('classifySkillLicense', () => {
  it.each([
    ['MIT', true],
    ['Apache-2.0', true],
    ['MIT OR Apache-2.0', true],
    ['(Apache-2.0 AND MIT)', true],
    ['GPL-3.0-or-later', true],
    ['CC-BY-4.0', true],
    ['CC-BY-NC-4.0', false], // некоммерческая — сайт этого не обещает
    ['Proprietary. LICENSE.txt has complete terms', false], // так пишут скиллы Anthropic
    ['All rights reserved', false],
    ['MIT for the additions; the base was handed over by its author without a license', false],
  ])('шапка «%s» → открытая: %s', (header, open) => {
    expect(classifySkillLicense(header, null).open).toBe(open)
  })

  it('шапки нет — решает текст LICENSE', () => {
    const mit = 'MIT License\n\nCopyright (c) 2025 Ann\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software…'
    expect(classifySkillLicense(undefined, mit)).toEqual({ id: 'MIT', open: true, from: 'file' })
    expect(classifySkillLicense(undefined, '                                 Apache License\n                           Version 2.0, January 2004').id).toBe('Apache-2.0')
  })

  it('не-SPDX в шапке («see LICENSE») — тоже решает текст файла', () => {
    expect(classifySkillLicense('See LICENSE', 'Redistribution and use in source and binary forms, with or without\nmodification, are permitted…').open).toBe(true)
  })

  it('ни шапки, ни файла — закрытая; незнакомый текст — закрытая', () => {
    expect(classifySkillLicense(undefined, null)).toEqual({ id: null, open: false, from: 'none' })
    expect(classifySkillLicense(undefined, 'You may look at this code.').open).toBe(false)
  })

  it('знакомый текст рядом со словом «All rights reserved» (частая строка копирайта) — открытая', () => {
    const bsd = 'Copyright (c) 2020 X. All rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided…'
    expect(classifySkillLicense(undefined, bsd).open).toBe(true)
  })

  const MIT_TEXT = 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software…'
  it.each([
    ['MIT + «только некоммерчески»', `${MIT_TEXT}\nThis software may be used for non-commercial purposes only.`],
    ['MIT + Commons Clause', `"Commons Clause" License Condition v1.0\n${MIT_TEXT}`],
    ['соглашение, цитирующее Apache', 'PROPRIETARY SOFTWARE LICENSE AGREEMENT\nThird-party parts: Apache License\n Version 2.0'],
    ['Business Source License', 'Business Source License 1.1'],
    ['Elastic License 2.0', 'Elastic License 2.0 (ELv2)'],
  ])('знакомый текст не перевешивает запрет: %s', (_name, text) => {
    expect(classifySkillLicense(undefined, text).open).toBe(false)
  })

  it('шапка MIT не перекрывает закрытый или незнакомый LICENSE — и наоборот', () => {
    expect(classifySkillLicense('MIT', 'Proprietary. All use requires a paid license.').open).toBe(false)
    expect(classifySkillLicense('MIT', 'Some custom terms nobody recognises.').open).toBe(false)
    expect(classifySkillLicense('Proprietary', MIT_TEXT).open).toBe(false)
    // Шапка называет свою, не открытую лицензию — файл MIT её не отменяет.
    expect(classifySkillLicense('LicenseRef-Acme-EULA', MIT_TEXT).open).toBe(false)
    expect(classifySkillLicense('MIT', MIT_TEXT)).toEqual({ id: 'MIT', open: true, from: 'header' })
  })

  it('незнакомый LICENSE называется «unknown», а не «без лицензии»', () => {
    expect(classifySkillLicense(undefined, 'Custom terms.').id).toBe('unknown')
  })

  it('узкие тексты раньше широких: LGPL не читается как GPL', () => {
    expect(licenseFromText('GNU LESSER GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007')).toBe('LGPL-3.0')
  })
})

describe('canBePublic', () => {
  it('запрещает только импорт без открытой лицензии', () => {
    expect(canBePublic({ sourceLicenseOpen: false })).toBe(false)
    expect(canBePublic({ sourceLicenseOpen: true })).toBe(true)
    expect(canBePublic({ sourceLicenseOpen: null })).toBe(true)
    expect(canBePublic({})).toBe(true)
    // Импорт с недописанным вердиктом — закрыт: источник есть, «открыто» не записано.
    expect(canBePublic({ sourceUrl: 'https://github.com/a/b/tree/x', sourceLicenseOpen: null })).toBe(false)
    expect(canBePublic({ sourceUrl: 'https://github.com/a/b/tree/x', sourceLicenseOpen: true })).toBe(true)
  })
})

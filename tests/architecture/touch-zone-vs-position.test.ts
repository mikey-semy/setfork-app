import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { walkSrc, relSrc } from '../helpers/walk-src'

/**
 * ЗОНА НАЖАТИЯ НЕ ОТМЕНЯЕТ ПОЗИЦИОНИРОВАНИЕ.
 *
 * `TOUCH_HIT` начинается с `pointer-coarse:relative`. Подставленный руками в `className`
 * рядом с `absolute`, он побеждает — но ТОЛЬКО на грубом указателе: кнопка выпадает в
 * поток и уезжает на телефоне, оставаясь правильной на десктопе. Так уезжали крестик
 * панели настроек, веер вставки блоков и — третьим — генератор заметки о правке
 * (снимок владельца 01.09.2026: звёздочка оказалась слева под полем).
 *
 * `buttonClass` этот случай знает: при собственном позиционировании он берёт зону БЕЗ
 * `relative`. Но знание работает, только если ему сказать `touch: 'hit'`, а не обойти
 * его, подмешав константу в `className`. Правило и требует пользоваться пропом.
 */
const POSITIONED = /(^|[\s`'"{])(absolute|fixed|sticky)([\s`'"}]|$)/
/** `TOUCH_HIT` целиком, но не `TOUCH_HIT_ZONE` и не `TOUCH_HIT_ROW` — у тех своя роль. */
const HIT = /\bTOUCH_HIT\b(?!_)/

describe('зона нажатия и позиционирование', () => {
  it('TOUCH_HIT не подставляется руками туда, где элемент позиционирован сам', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src', import.meta.url).pathname)) {
      if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue
      // ⚠️ Комментарии пропускаем ПО СОСТОЯНИЮ, а не по началу строки. Правило само
      // разбирается в этом коде, и объяснение рядом с кнопкой законно называет и
      // `TOUCH_HIT`, и `absolute`; сейчас они стоят на разных строках, но перенос
      // одного слова при переформатировании уронил бы CI на прозе.
      let inComment = false
      for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        const t = line.trimStart()
        if (inComment) {
          if (t.includes('*/')) inComment = false
          continue
        }
        if (t.startsWith('//')) continue
        if (t.startsWith('/*') || t.startsWith('{/*')) {
          if (!line.includes('*/')) inComment = true
          continue
        }
        if (HIT.test(line) && POSITIONED.test(line)) offenders.push(`${relSrc(file)}:${i + 1}`)
      }
    }
    expect(
      offenders,
      'зону задаёт проп touch="hit" — иначе pointer-coarse:relative перебьёт absolute и только на телефоне',
    ).toEqual([])
  })

  it('проверке есть что проверять', () => {
    // Анти-вырождение: константа могла быть переименована, и правило искало бы то,
    // чего в коде нет вовсе.
    const files = walkSrc(new URL('../../src', import.meta.url).pathname)
    const users = files.filter((f) => /\.tsx?$/.test(f) && HIT.test(readFileSync(f, 'utf8')))
    expect(users.length, 'TOUCH_HIT нигде не используется — правило потеряло предмет').toBeGreaterThan(1)
  })
})

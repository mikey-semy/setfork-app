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
/** Символов вокруг вхождения: одно `className` целиком, даже разнесённое по строкам. */
const WINDOW = 220

describe('зона нажатия и позиционирование', () => {
  it('TOUCH_HIT не подставляется руками туда, где элемент позиционирован сам', () => {
    const offenders: string[] = []
    for (const file of walkSrc(new URL('../../src', import.meta.url).pathname)) {
      if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue
      // ⚠️ Ищем не по СТРОКАМ, а по тексту: длинное `className` переносят, и
      // `absolute` с `TOUCH_HIT` легко оказываются на разных строках — построчная
      // проверка пропустила бы ровно тот случай, ради которого написана.
      // Комментарии вырезаем целиком: правило само разбирается в этом коде, и
      // объяснение рядом с кнопкой законно называет обе вещи (находка Codex #855).
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
        // Строка импорта называет константу, но ничего ею не задаёт.
        .replace(/^\s*import[\s\S]*?from\s+'[^']+'\s*$/gm, ' ')
      for (const m of src.matchAll(new RegExp(HIT, 'g'))) {
        const around = src.slice(Math.max(0, m.index - WINDOW), m.index + WINDOW)
        if (POSITIONED.test(around)) {
          offenders.push(`${relSrc(file)}:${src.slice(0, m.index).split('\n').length}`)
        }
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

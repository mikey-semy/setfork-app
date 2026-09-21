import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ListBlock } from '@/core'
import { toWireContent } from '@/features/git/list-content'
import { toListContent } from '@/features/library/list-content'
import type { ProposedItem } from '@/shared/db'

// Узда: каждое поле блока доезжает до ядра.
//
// Чинила она вот что. Человек ставил «разрушительный пункт» на блоке, ЗАВЕДЁННОМ В
// ВЕТКЕ, сохранял, правка выглядела принятой — а после слияния пометки не было, без
// единой ошибки. Причина: конвертер провода четыре поля не собирал вовсе, полагаясь
// на то, что ядро перенесёт их из текущей версии по blockId. Оно переносит — но
// только для блока, который в той версии ЕСТЬ, а у нового блока его нет по
// определению. Так же молча терялись imageKey, needsHuman и needsHumanAsk.
//
// Поэтому список полей здесь НЕ перечислен руками: руками перечисляют то, о чём уже
// подумали, а дефект был ровно в четырёх полях, о которых не подумали. Список
// читается из объявления `ListBlock`, и семнадцатое поле уронит узду само — до того,
// как кто-нибудь заметит пропажу на проде.

const PORTS = 'src/core/ports.ts'

/** Имена полей `ListBlock` из исходника порта: источник — объявление типа. */
function declaredBlockFields(): string[] {
  const src = readFileSync(PORTS, 'utf8')
  const body = src.match(/export interface ListBlock \{\n([\s\S]*?)\n\}/)?.[1]
  if (!body) throw new Error(`не нашёл объявление ListBlock в ${PORTS} — узда потеряла источник списка`)
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1])
}

/** Куда доменное поле кладётся на проводе (имена расходятся только у content). */
const WIRE_OF: Record<keyof Required<ListBlock>, string> = {
  n: 'n',
  type: 'type',
  content: 'contentJson',
  blockId: 'blockId',
  title: 'title',
  desc: 'desc',
  command: 'command',
  level: 'level',
  why: 'why',
  section: 'section',
  subtasks: 'subtasks',
  refs: 'refs',
  danger: 'danger',
  imageKey: 'imageKey',
  needsHuman: 'needsHuman',
  needsHumanAsk: 'needsHumanAsk',
}

/** Блок, у которого заполнено ВСЁ: пустое поле не отличить от потерянного. */
const FILLED: Required<ListBlock> = {
  n: 1,
  type: 'text',
  content: { md: 'Вступление' },
  blockId: '7b3f1a5e-0000-4000-8000-000000000001',
  title: 'Снести том',
  desc: 'Освободить место',
  command: 'docker volume rm data',
  level: 'required',
  why: 'иначе не хватит диска',
  section: 'Подготовка',
  subtasks: ['проверить бэкап'],
  refs: [{ label: 'док', url: 'https://example.org' }],
  danger: true,
  imageKey: 'u/1/shot.png',
  needsHuman: true,
  needsHumanAsk: 'Какой том у вас лишний?',
}

/** Тот же блок в форме хранения — вход канонического близнеца. */
const FILLED_ITEM: ProposedItem = {
  type: FILLED.type,
  content: FILLED.content,
  blockId: FILLED.blockId as string,
  title: { en: FILLED.title },
  desc: { en: FILLED.desc },
  command: FILLED.command,
  hasImage: true,
  imageKey: FILLED.imageKey,
  level: 'required',
  why: { en: FILLED.why },
  section: { en: FILLED.section },
  subtasks: [{ en: 'проверить бэкап' }],
  refs: [{ label: { en: 'док' }, url: 'https://example.org' }],
  danger: FILLED.danger,
  needsHuman: FILLED.needsHuman,
  needsHumanAsk: { en: FILLED.needsHumanAsk },
}

/** «Значение доехало»: пустая строка, false и пустой список — это потеря. */
const carried = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v !== '' && v !== false && v != null)

describe('поля блока доезжают до ядра', () => {
  it('раскладка на провод знает про каждое поле ListBlock', () => {
    expect([...declaredBlockFields()].sort()).toEqual(Object.keys(WIRE_OF).sort())
  })

  it('заполненный блок не теряет на проводе ни одного поля', () => {
    const [wire] = toWireContent({ title: 'Л', desc: '', tags: [], ordered: true, version: 1, steps: [FILLED] }).steps
    const lost = declaredBlockFields().filter((f) => !carried((wire as Record<string, unknown>)[WIRE_OF[f as keyof ListBlock]]))
    expect(lost).toEqual([])
  })

  it('канонический близнец (правка предложения) тоже не теряет ни одного поля', () => {
    const meta = { title: 'Л', desc: '', tags: [], ordered: true, version: 1 }
    const [block] = toListContent([FILLED_ITEM], meta, 'ru').steps
    const lost = declaredBlockFields().filter((f) => !carried((block as unknown as Record<string, unknown>)[f]))
    expect(lost).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import { SRC, walkFiles, rel, tags, classesOf, attr, hasAttr } from './ui-scan.mjs'

/**
 * В ОДНОМ РЯДУ — ОДНА ПОЛИТИКА ТАЧ-ЦЕЛИ.
 *
 * У контролов два способа добрать палец до 44px, и оба законные:
 *  • `grow` — контрол РАСТЁТ на грубом указателе (`pointer-coarse:min-h-11`);
 *  • `hit`/`fixed` — вид остаётся по шкале, цель добирает невидимая зона.
 *
 * Беда начинается, когда в одном ряду встречаются оба. На мыши ряд выглядит ровным, на
 * сенсоре один контрол становится 44px, а сосед остаётся 32px — и ряд разъезжается ровно
 * у тех людей, у кого сенсор. Разработчик своего дефекта не видит вовсе.
 *
 * Так и вышло 27.08.2026: владелец назвал «кнопка не по высоте поиска» в ТРЁХ разных
 * местах, а `ui-sizes` при этом честно докладывал «рядов с разными ступенями у соседей:
 * 0» — потому что ступень у всех была одна, `md`. Расходилась политика, а её не сравнивал
 * никто. Гейт зелёный, интерфейс разъехался.
 *
 * ⚠️ Проверка смотрит ЯВНО ЗАДАННУЮ политику, а не дефолты. Дефолты — дело примитивов, и
 * они уже сведены (у полей роста нет, решение записано в control.ts от 13.08). Здесь
 * ловится другое: когда кто-то ЯВНО поставил `grow` рядом с тем, кто явно поставил
 * `fixed`/`hit`, — то есть противоречие, написанное в одном месте двумя руками.
 */

/** Контролы, у которых политика тач-цели вообще есть. */
// SearchForm — обёртка над SearchField (GET-форма поиска); в ряду это тот же контрол,
// и без него ряд на странице обсуждений содержал 'один контрол' и не проверялся вовсе.
const CONTROL = /^(Button|IconButton|SubmitButton|SearchField|SearchForm|Input|Select|SelectTrigger|TagInput|Segment)$/

/** Растёт ли контрол на грубом указателе. */
// Дефолт у ВСЕХ примитивов — «не растём»: решение по полям записано в control.ts от
// 13.08, кнопки добирают цель зоной. Поэтому явный `grow` рядом с чем угодно другим —
// уже разнобой, даже если сосед политику не объявлял. Раньше проверка сравнивала
// только явные и потому пропустила ряд на странице обсуждений: кнопка «Новое
// обсуждение» просила `grow`, поле поиска молчало — и после смены умолчания поля
// кнопка стала ВЫШЕ соседа (P2 авто-ревью #830).
const policyOf = (attrs) =>
  attr(attrs, 'touch') === 'grow' || /buttonClass\(\{[^})]*touch:\s*'grow'/.test(attrs) ? 'grow' : 'fixed'

/** Контрол ли это: примитив по имени ЛИБО что угодно, одетое в buttonClass. */
const isControl = (el) => CONTROL.test(el.tag) || /buttonClass\(/.test(el.attrs)

export function mixedTouchRows() {
  const out = []
  for (const file of walkFiles(SRC, ['.tsx'])) {
    const src = readFileSync(file, 'utf8')
    const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    const els = [...tags(code)]

    for (const row of els) {
      const cls = classesOf(row.attrs)
      // Ряд — горизонтальный флекс. `flex-col` не ряд: там высоты и не обязаны совпадать.
      const isRow = /(^|\s)(flex|inline-flex)(\s|$)/.test(cls) && !/(^|\s)flex-col(\s|$)/.test(cls)
      if (!isRow) continue

      const kids = []
      for (const e of els) {
        if (e.index <= row.index || e.index > row.index + 1200) continue
        const c = classesOf(e.attrs)
        // Вложенный контейнер переориентирует ряд — дальше уже не наши дети.
        if (/(^|\s)flex-col(\s|$)/.test(c) || /(^|\s)grid(\s|$)/.test(c)) break
        if (isControl(e)) kids.push(e)
      }
      if (kids.length < 2) continue

      const policies = new Set(kids.map((k) => policyOf(k.attrs)))
      if (policies.size > 1) {
        out.push({ path: rel(file), line: row.line, tags: kids.map((k) => `${k.tag}:${policyOf(k.attrs)}`) })
      }
    }
  }
  return out
}

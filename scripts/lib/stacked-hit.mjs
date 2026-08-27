import { readFileSync } from 'node:fs'
import { SRC, walkFiles, rel, tags, classesOf, attr, hasAttr } from './ui-scan.mjs'

/**
 * ЗОНЫ НАЖАТИЯ, ВИСЯЩИЕ ДРУГ НА ДРУГЕ.
 *
 * `touch="hit"` (дефолт у Button/IconButton) растит область нажатия до 44px вверх и
 * вниз, НЕ занимая места в потоке. Для целей, стоящих в ряд по горизонтали, это ровно
 * то что нужно: зона уходит в пустоту над и под кнопкой. Для целей, стоящих В СТОЛБИК,
 * это ловушка: две кнопки по 24px получают зоны по 44px, зоны перекрываются на 20px, и
 * тап у границы делает ДЕЙСТВИЕ СОСЕДА.
 *
 * Хуже мелкой цели: это не промах, который человек заметит и повторит, а тихое
 * срабатывание не того. В квизе стрелки порядка так двигали пункт в обратную сторону.
 *
 * Ловится статически: контейнер с `flex-col` (или `grid` в одну колонку), внутри два и
 * более `IconButton`/`Button` подряд, и хотя бы у двух не задан `touch`. Лечится
 * `touch="grow"` (кнопка растёт сама) или `TOUCH_HIT_ROW` (зона с резервом места).
 */
export function stackedHits() {
  const out = []
  for (const file of walkFiles(SRC, ['.tsx'])) {
    const src = readFileSync(file, 'utf8')
    const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    const els = [...tags(code)]
    for (let i = 0; i < els.length; i++) {
      const col = els[i]
      const cls = classesOf(col.attrs)
      if (!/(^|\s)flex-col(\s|$)/.test(cls)) continue
      // Дети именно ЭТОГО контейнера, а не любые кнопки поблизости. Между столбцом и
      // кнопкой не должно быть другого контейнера — он бы переориентировал ряд.
      //
      // ⚠️ Первая версия брала «всё в пределах 900 знаков» и выдала два ложных: там
      // `flex-col` — это <form>, а кнопки внутри лежат в своём `flex-wrap` РЯДУ, то
      // есть стоят бок о бок и перекрываться зонами не могут. Ошибка ровно того рода,
      // которую этот проект уже ловил шесть раз (K41*): замер числит законное долгом.
      const kids = []
      for (const e of els) {
        if (e.index <= col.index || e.index > col.index + 1200) continue
        const c = classesOf(e.attrs)
        if (/(^|\s)(flex|grid|inline-flex)(\s|$)/.test(c) || /(^|\s)flex-(row|wrap)(\s|$)/.test(c)) break
        if (/^(IconButton|Button)$/.test(e.tag)) kids.push(e)
      }
      if (kids.length < 2) continue
      const bare = kids.filter((k) => !hasAttr(k.attrs, 'touch'))
      if (bare.length >= 2) out.push({ path: rel(file), line: col.line, count: bare.length })
    }
  }
  return out
}

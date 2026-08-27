import { readFileSync } from 'node:fs'
import { SRC, walkFiles, rel, tags, classesOf, attr, hasAttr } from './ui-scan.mjs'

/**
 * ЗОНЫ НАЖАТИЯ, ВИСЯЩИЕ ДРУГ НА ДРУГЕ.
 *
 * `touch="hit"` (дефолт у Button и IconButton) растит область нажатия до 44px вверх и
 * вниз, НЕ занимая места в потоке. Для целей, стоящих в ряд по горизонтали, это ровно
 * то что нужно: зона уходит в пустоту над и под кнопкой. Для целей, оказавшихся ДРУГ
 * НАД ДРУГОМ, это ловушка: зоны перекрываются, и тап у границы делает действие соседа.
 *
 * Хуже мелкой цели: это не промах, который человек заметит и повторит, а тихое
 * срабатывание не того. В квизе стрелки порядка так двигали пункт в обратную сторону,
 * в метках задачи — снимали чужую метку (обе находки авто-ревью, 27.08.2026).
 *
 * Друг над другом цели оказываются ДВУМЯ способами, и второй я сначала пропустил:
 *  • `flex-col` — по замыслу;
 *  • `flex-wrap` — ряд, который при переносе строки становится столбиком. Этот хуже:
 *    в вёрстке он выглядит горизонтальным, и увидеть проблему можно, только представив
 *    себе узкий экран.
 *
 * ⚠️ Одного «контейнер переносит строки» МАЛО, и первая версия узды на этом выдала
 * тринадцать мест, из которых почти все законны. Перекрытие СЧИТАЕТСЯ, а не
 * предполагается: зона 44px вокруг кнопки высотой H выступает на `(44 − H) / 2` сверху
 * и снизу, значит соседним строкам нужен зазор не меньше `44 − H`. Ряд кнопок `md`
 * (32px) с `gap-3` (12px) безопасен; ряд `xs` (24px) с `gap-1.5` (6px) — нет.
 *
 * Лечится `touch="grow"` (кнопка растёт сама, место резервируется) или `TOUCH_HIT_ROW`.
 */

/** Высота ступени шкалы в пикселях — то же, что CONTROL_H в shared/ui/control.ts. */
const STEP_H = { xs: 24, sm: 28, md: 32, lg: 40, xl: 44 }

/** Шаг Tailwind в пикселях: `gap-1.5` = 6px. */
const gapPx = (cls) => {
  const m = /(?:^|\s)gap(?:-y)?-(\d+(?:\.\d+)?)(?:\s|$)/.exec(cls)
  return m ? Number(m[1]) * 4 : 0
}

const TOUCH = 44

export function stackedHits() {
  const out = []
  for (const file of walkFiles(SRC, ['.tsx'])) {
    const src = readFileSync(file, 'utf8')
    const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    const els = [...tags(code)]
    for (const col of els) {
      const cls = classesOf(col.attrs)
      const stacks = /(^|\s)flex-col(\s|$)/.test(cls) || /(^|\s)flex-wrap(\s|$)/.test(cls)
      if (!stacks) continue
      const gap = gapPx(cls)

      // Дети именно ЭТОГО контейнера. Между ним и кнопкой не должно быть другого
      // контейнера — он бы переориентировал ряд. Первая версия брала «всё в пределах
      // 900 знаков» и ловила кнопки из вложенных рядов: ошибка того же рода, что
      // счётчик ролей допускал шесть раз (K41* в карте корней).
      const kids = []
      for (const e of els) {
        if (e.index <= col.index || e.index > col.index + 1200) continue
        const c = classesOf(e.attrs)
        if (/(^|\s)(flex|grid|inline-flex)(\s|$)/.test(c) || /(^|\s)flex-(row|col)(\s|$)/.test(c)) break
        if (/^(IconButton|Button)$/.test(e.tag)) kids.push(e)
      }
      if (kids.length < 2) continue

      const bare = kids.filter((k) => !hasAttr(k.attrs, 'touch'))
      if (bare.length < 2) continue

      // Считаем по САМОЙ НИЗКОЙ кнопке ряда: она выступает зоной дальше всех.
      const heights = bare.map((k) => STEP_H[attr(k.attrs, 'size') ?? 'md'] ?? STEP_H.md)
      const lowest = Math.min(...heights)
      const need = TOUCH - lowest
      if (gap >= need) continue

      out.push({ path: rel(file), line: col.line, count: bare.length, gap, need })
    }
  }
  return out
}

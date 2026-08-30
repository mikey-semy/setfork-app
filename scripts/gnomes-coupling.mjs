import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * СКОЛЬКО НЕ-ГНОМЬЕГО КОДА ЗАВИСИТ ОТ ГНОМОВ — число, а не мнение.
 *
 * Спор «выносить ли гномов из продукта» до сих пор шёл словами: одни говорят «это ядро»,
 * другие «это отдельный сервис, тянущий половину кода». Обе стороны правы ровно
 * настолько, насколько велика связность, — а её никто не мерил. Это и есть замер.
 *
 * Мало связей — вынести дёшево. Много — вынос означает переписать половину библиотеки,
 * и спор закрыт арифметикой.
 *
 * ⚠️ ПОЧЕМУ НЕ ГРАНИЦА В ESLINT. Две причины, обе выяснены на живом прогоне:
 *  • плагин сопоставляет образцы с ПАПКАМИ, файловый образец он игнорирует с
 *    предупреждением — половина гномьих модулей (`shared/ai/gnome-*.ts`) в тип не
 *    попадает вовсе, и граница выглядит работающей, не видя ничего;
 *  • подавления в baseline считаются по правилу на файл, а не по виду нарушения: файл
 *    с уже подавленным кросс-импортом фич поглотит и «features → gnomes».
 * Счётчик читает импорты сам и baseline не спрашивает — поэтому его числу можно верить.
 *
 * ⚠️ СЧИТАЕТ И ДИНАМИЧЕСКИЕ ИМПОРТЫ. `await import('@/shared/ai/gnome-account')` — такая
 * же связь, как статическая: при выносе её точно так же придётся чинить. Гейт границ их
 * не видит, и это вторая причина считать отдельно.
 */

/** Что считается «гномьим». Признак — предмет, а не каталог. */
const GNOME = [
  /@\/shared\/ai\/gnome[\w-]*/,
  /@\/shared\/ai\/council[\w-]*/,
  /@\/features\/dig(\/|')/,
  /@\/features\/library\/gnome-[\w-]*/,
]

/** Сам гномий код себя не считает: связь внутри предмета при выносе переезжает целиком. */
const IS_GNOME_FILE = (rel) =>
  /^src\/(features\/dig|features\/library\/gnome-|shared\/ai\/gnome|shared\/ai\/council)/.test(rel)

/**
 * Поверхности НЕ считаются: app, widgets, mcp, admin и садовник показывают гномов, как
 * любую фичу. Считаем то, что при выносе пришлось бы переписать, а не то, что просто
 * перестало бы показываться.
 */
const IS_SURFACE = (rel) => /^src\/(app|widgets|features\/(mcp|admin|gardener))\//.test(rel)

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

const root = new URL('..', import.meta.url).pathname
const hits = []
for (const file of walk(join(root, 'src'))) {
  const rel = file.slice(file.indexOf('src/'))
  if (IS_GNOME_FILE(rel) || IS_SURFACE(rel)) continue
  const src = readFileSync(file, 'utf8')
  for (const [i, line] of src.split('\n').entries()) {
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
    if (GNOME.some((re) => re.test(line))) hits.push(`${rel}:${i + 1}`)
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ count: hits.length, hits }, null, 2))
} else {
  console.log(`связей с гномами из не-гномьего кода: ${hits.length}`)
  for (const h of hits) console.log('  ' + h)
}

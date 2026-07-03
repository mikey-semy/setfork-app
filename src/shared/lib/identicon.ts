// Детерминированный identicon 5×5 (порт из макета SetFork.dc.html).
// Возвращает массив из 25 булевых ячеек (зеркальных по вертикали).
export function identiconCells(seed: string): boolean[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const grid: boolean[][] = []
  for (let y = 0; y < 5; y++) {
    grid.push([])
    for (let x = 0; x < 3; x++) {
      h = (h * 1103515245 + 12345) >>> 0
      grid[y].push(((h >> 18) & 1) === 1)
    }
  }
  const cells: boolean[] = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const sx = x < 3 ? x : 4 - x
      cells.push(grid[y][sx])
    }
  }
  return cells
}

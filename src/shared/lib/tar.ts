import { gzipSync } from 'node:zlib'

/**
 * АРХИВ .tar.gz БЕЗ ЗАВИСИМОСТЕЙ — ровно столько ustar, сколько нужно для раздачи папки.
 *
 * Своим кодом, а не пакетом: формат — это 512-байтный заголовок на файл, данные с
 * добивкой нулями до 512 и два пустых блока в конце (POSIX.1-1988, `ustar`). Сжатие
 * даёт встроенный `zlib`. Пакет ради этого тянул бы в прод зависимость с потоками,
 * символическими ссылками и правами — всем тем, чего раздача сгенерированной папки
 * не делает и делать не должна.
 *
 * Чего здесь сознательно НЕТ, и почему это защита, а не недоделка:
 *  • символических и жёстких ссылок — архив пишет только обычные файлы и каталоги;
 *  • путей с `..`, абсолютных и пустых сегментов — их отвергает `assertSafePath`: архив
 *    распаковывают чужие программы, и путь из архива не должен выводить за его папку;
 *  • длинных имён (GNU/pax-расширений) — путь длиннее 100 байт считается ошибкой
 *    вызывающего, а не молча обрезается: обрезанный путь лёг бы не туда.
 */

export interface TarEntry {
  /** Путь внутри архива, через `/`. Каталоги — с `/` на конце. */
  path: string
  /** Содержимое файла. У каталога — пусто. */
  content?: string | Uint8Array
  /** Права в восьмеричном виде: 0o644 для файла, 0o755 для исполняемого и каталога. */
  mode?: number
}

const BLOCK = 512

function assertSafePath(path: string): void {
  const bare = path.endsWith('/') ? path.slice(0, -1) : path
  // Абсолютный путь отдельной проверки не требует: `/etc/passwd` начинается с пустого
  // сегмента, и его отвергает то же правило, что и `a//b`.
  if (!bare || bare.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`tar: unsafe path ${JSON.stringify(path)}`)
  }
  if (Buffer.byteLength(path) > 100) throw new Error(`tar: path longer than 100 bytes: ${path}`)
}

/** Число в восьмеричном поле фиксированной ширины: цифры, добитые нулями, и NUL в конце. */
function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0'
}

function header(path: string, size: number, mode: number, mtime: number, dir: boolean): Buffer {
  const h = Buffer.alloc(BLOCK)
  h.write(path, 0, 100, 'utf8')
  h.write(octal(mode, 8), 100, 8, 'ascii')
  h.write(octal(0, 8), 108, 8, 'ascii') // uid
  h.write(octal(0, 8), 116, 8, 'ascii') // gid
  h.write(octal(size, 12), 124, 12, 'ascii')
  h.write(octal(mtime, 12), 136, 12, 'ascii')
  // Поле контрольной суммы при её подсчёте считается восемью пробелами (POSIX).
  h.write('        ', 148, 8, 'ascii')
  h.write(dir ? '5' : '0', 156, 1, 'ascii')
  h.write('ustar\0', 257, 6, 'ascii')
  h.write('00', 263, 2, 'ascii')
  let sum = 0
  for (const b of h) sum += b
  // Шесть восьмеричных цифр, NUL и пробел — форма, которую понимают все распаковщики.
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  return h
}

/**
 * Собрать архив. `mtime` — секунды эпохи для всех записей: один и тот же вход даёт
 * одни и те же байты, поэтому ответ можно кешировать и сравнивать.
 */
export function tarGz(entries: TarEntry[], mtime = 0): Buffer {
  const parts: Buffer[] = []
  for (const e of entries) {
    assertSafePath(e.path)
    const dir = e.path.endsWith('/')
    const data = dir ? Buffer.alloc(0) : Buffer.from(e.content ?? '')
    parts.push(header(e.path, data.length, e.mode ?? (dir ? 0o755 : 0o644), mtime, dir))
    if (data.length) {
      parts.push(data)
      const pad = (BLOCK - (data.length % BLOCK)) % BLOCK
      if (pad) parts.push(Buffer.alloc(pad))
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2)) // конец архива — два нулевых блока
  return gzipSync(Buffer.concat(parts))
}

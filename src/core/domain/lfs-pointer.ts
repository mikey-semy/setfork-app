/**
 * ДВОИЧНЫЙ ФАЙЛ СКИЛЛА — указателем Git LFS в дереве, байты — в хранилище по sha256.
 *
 * Форма та же, что у Git LFS (https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md):
 * три строки, `version` первой, остальные ключи по алфавиту, LF, перевод строки в конце.
 * Так дерево списка остаётся текстовым (ядро и формат `list.json` не меняются), а версия
 * всё равно закрепляет байты — хеш лежит в её коммите (ADR-0028 п.4; отклонение от
 * «хеш в list.json» — в пользу формы, которую знают git и все форджи).
 */
const VERSION = 'version https://git-lfs.github.com/spec/v1'
const POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (0|[1-9]\d*)\n$/

export interface LfsPointer {
  oid: string
  size: number
}

export const lfsPointerText = (p: LfsPointer): string => `${VERSION}\noid sha256:${p.oid}\nsize ${p.size}\n`

/** Разобрать указатель. Строго по форме: всё прочее — обычный текстовый файл. */
export function parseLfsPointer(text: string): LfsPointer | null {
  const m = POINTER.exec(text)
  return m ? { oid: m[1], size: Number(m[2]) } : null
}

/** То же по байтам: указатель короче 200 байт, длинный файл им быть не может. */
export function lfsPointerOf(content: Uint8Array): LfsPointer | null {
  if (content.length > 200) return null
  return parseLfsPointer(new TextDecoder().decode(content))
}

/** Двоичный ли файл: признак тот же, что у git и у ядра, — нулевой байт. */
export const isBinary = (content: Uint8Array): boolean => content.includes(0)

/** Двоичное разрешено только в `assets/`: скрипты и справка — текст, их читают глазами. */
export const binaryAllowedAt = (path: string): boolean => path.startsWith('assets/')

/**
 * Исполняемый файл платформы — по сигнатуре, а не по имени. Скилл уезжает к чужим агентам,
 * и раздавать через него программы для Windows, Linux или macOS мы не берёмся: сервер их не
 * запускает, но становился бы их раздатчиком.
 */
export function nativeExecutable(content: Uint8Array): 'pe' | 'elf' | 'mach-o' | null {
  const b = content
  if (b[0] === 0x4d && b[1] === 0x5a) return 'pe' // MZ
  if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return 'elf'
  const magic = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return 'mach-o'
  return null
}

/** Что показывать о файле автора: настоящий размер и признак двоичного. У указателя в
 *  `assets/` размер — из указателя, а не длина самого указателя (~130 байт). */
export function authoredFileInfo(path: string, content: Uint8Array): { bytes: number; binary: boolean } {
  const pointer = binaryAllowedAt(path) ? lfsPointerOf(content) : null
  return pointer ? { bytes: pointer.size, binary: true } : { bytes: content.length, binary: false }
}

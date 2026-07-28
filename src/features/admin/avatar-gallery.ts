import 'server-only'

/**
 * Галерея встроенных персонажей — читаем каталог, а не держим список руками: дорисовал
 * картинку в public/gnomes → она появилась в выборе сама.
 *
 * Вынесено из страницы зала совета: теперь галерея нужна и странице отдельного специалиста
 * (настройки переехали туда), а две копии чтения каталога разъехались бы при первой правке.
 */
export async function builtinAvatars(): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  try {
    const files = await readdir(join(process.cwd(), 'public', 'gnomes'))
    return files
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.slice(0, -5))
      .sort()
  } catch {
    return []
  }
}

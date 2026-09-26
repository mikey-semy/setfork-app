import { asImageType, IMAGE_EXT } from './limits'

/**
 * Файл из результата `canvas.toBlob`: тип и расширение — по тому, что кодировщик
 * ДЕЙСТВИТЕЛЬНО вернул, а не по тому, что у него просили. По спеке (WHATWG HTML,
 * «serialising a bitmap to a file») неподдерживаемый тип даёт PNG — и Safari так и
 * делает с `image/webp`: просили WebP, получили PNG. Назвать его `.webp` значило
 * соврать серверу и хранилищу.
 *
 * Пустой или чужой тип → PNG: единственный формат, который спека обязывает уметь
 * каждый браузер, и он сохраняет прозрачность.
 */
export function encodedFile(blob: Blob, baseName: string): File {
  const type = asImageType(blob.type) ?? 'image/png'
  return new File([blob], `${baseName}.${IMAGE_EXT[type]}`, { type })
}

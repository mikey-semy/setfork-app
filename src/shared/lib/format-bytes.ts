/** Размер файла для подписи: байты, килобайты или мегабайты — как у проводников. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** #RRGGBB (регистр любой). Пустое/битое отбрасываем на валидации. */
export function isHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s)
}

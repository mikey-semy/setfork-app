// ⚠️ ОТДЕЛЬНЫМ МОДУЛЕМ, а не рядом с экшенами: файл действий помечен 'use server', и
// каждый его экспорт обязан быть async-функцией — сборка падает с «Server Actions must
// be async functions». Типы, линт и 2214 тестов этого не ловят: ошибка видна ТОЛЬКО
// сборке.

/**
 * ЧТО СКАЗАТЬ ЧЕЛОВЕКУ ПОСЛЕ СОХРАНЕНИЯ — правило отдельно от редиректа, чтобы его
 * можно было проверить без формы и сессии.
 *
 * Сохранение проходит ВСЕГДА (см. `saveDraft`), поэтому единственное, чем отличаются
 * случаи, — что именно человек должен узнать. Молчание здесь и есть тот дефект, который
 * чинится: затирание чужих правок и запрещённая команда раньше не сообщались никак.
 */
export function saveOutcomeQuery(o: { overwrote: boolean; destructiveStep: number | null }): string {
  const parts = ['saved=1']
  if (o.overwrote) parts.push('over=1')
  if (o.destructiveStep !== null) parts.push('warn=destructive', `step=${o.destructiveStep}`)
  return parts.join('&')
}


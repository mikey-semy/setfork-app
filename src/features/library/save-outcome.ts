import type { DraftRef } from './draft'
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
export function saveOutcomeQuery(o: {
  overwrote: boolean
  destructiveStep: number | null
  secret?: { step: number; rule: string } | null
}): string {
  const parts = ['saved=1']
  if (o.overwrote) parts.push('over=1')
  // Предупреждение одно, и ключ доступа — первым: команда опасна тому, кто её запустит,
  // а ключ утекает в момент публикации. Команду назовёт следующее сохранение.
  if (o.secret) parts.push('warn=secret', `step=${o.secret.step}`, `kind=${o.secret.rule}`)
  else if (o.destructiveStep !== null) parts.push('warn=destructive', `step=${o.destructiveStep}`)
  return parts.join('&')
}

/**
 * ОСТАНОВИТЬ ЛИ ПУБЛИКАЦИЮ — одно правило на все входы, а не решение на месте вызова.
 *
 * Сигнал о затирании вырабатывался и ТЕРЯЛСЯ: `publishEdits` выбрасывал исход записи и
 * звал публикацию как ни в чём не бывало. Сторож срабатывал, дверь открывалась —
 * правки агента уходили в КОММИТ, а человек об этом даже не читал.
 *
 * ⚠️ Отказ здесь безопасен, в отличие от «Сохранить»: черновик к этому моменту УЖЕ
 * записан, набранное не теряется. Человек видит, что случилось, и жмёт «Опубликовать»
 * второй раз — страница к тому времени перечитала черновик, ревизия совпадает, и
 * публикация проходит. Это подтверждение повтором, а не тупик.
 */
export function shouldHoldPublish(o: { overwrote: boolean }): boolean {
  return o.overwrote
}

/** Адрес возврата, когда публикация остановлена: сохранение состоялось, публикация — нет. */
export function publishHeldQuery(): string {
  return 'saved=1&over=1&held=1'
}

/**
 * Что кладёт форма редактора в скрытое поле: ЧТО именно видел автор — версию списка
 * и состояние его черновика.
 *
 * ⚠️ СТРОКА И НОМЕР, а не номер сам по себе: `rev` каждого нового черновика начинается
 * с 1, поэтому голый счётчик опознаёт возраст, а не объект. Черновик опубликовали,
 * агент завёл новый — у обоих `rev = 1`, и сравнение говорит «ничего не менялось»
 * (ABA; второй P1 авто-ревью по #945).
 *
 * ⚠️ Черновика нет — это явное `'none'`, а не пустая строка. Пустая доезжает до записи
 * как `undefined` = «сравнивать не с чем» и отключает сверку целиком: страницу открыли
 * без черновика, агент создал его при авторе — и первое же «Сохранить» стирало его
 * правки молча (первый P1 там же).
 *
 * Правило живёт здесь, а не в разметке, чтобы его можно было проверить тестом.
 */
export function draftRefField(
  listVersion: number,
  draft: { id: string; rev: number } | null | undefined,
): string {
  return `${listVersion}@${draft ? `${draft.id}:${draft.rev}` : 'none'}`
}

/**
 * Разобрать то, что прислала форма. Неразбираемое — как «поля не прислали»: сверять
 * не с чем, и выдумывать здесь опаснее, чем промолчать.
 */
export function parseDraftRef(raw: unknown): DraftRef | undefined {
  if (typeof raw !== 'string') return undefined
  const split = raw.indexOf('@')
  if (split <= 0) return undefined
  const listVersion = Number(raw.slice(0, split))
  if (!Number.isFinite(listVersion)) return undefined
  const rest = raw.slice(split + 1)
  if (rest === 'none') return { listVersion, draft: 'none' }
  const at = rest.lastIndexOf(':')
  if (at <= 0) return undefined
  const rev = Number(rest.slice(at + 1))
  return Number.isFinite(rev) ? { listVersion, draft: { id: rest.slice(0, at), rev } } : undefined
}

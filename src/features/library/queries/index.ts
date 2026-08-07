/**
 * Чтения библиотеки списков — вход прежний (`@/features/library/queries`), внутри
 * разложено по сюжетам: лента и поиск, сам список с версиями, предложения правок,
 * люди.
 *
 * ВАЖНО: это СЫРЫЕ загрузчики, они не гейтят видимость. Страницы обязаны ходить
 * через `guard.ts` (requireViewableMeta/requireViewableDetail) — линт следит за этим
 * правилом отдельно, и разбор его не отменяет.
 */
export * from './list'
export * from './suggestions'
export * from './people'
export * from './feed'

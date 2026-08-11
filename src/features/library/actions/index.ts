/**
 * Серверные экшены библиотеки списков — вход остался прежним (`@/features/library/actions`),
 * а внутри разложено по причинам изменения: загрузки файлов, версии и черновики,
 * предложения правок, ИИ, форки, настройки списка.
 *
 * Фасад нужен ровно затем, чтобы разбор не превратился в правку семидесяти двух
 * импортёров: место входа не меняется, меняется устройство за ним.
 */
export * from './canon'
export * from './list-settings'
export * from './rename'
export * from './uploads'
export * from './ai'
export * from './suggestions'
export * from './suggestion-branch'
export * from './suggestion-items'
export * from './suggestion-comments'
export * from './forks'
export * from './versions'

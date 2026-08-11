// Совет гномов: вход остался прежним (`@/shared/ai/council`), внутри — этапы по файлам.
// Фасад держит импортёров неподвижными, пока core.ts худеет: у него три потребителя —
// features/generation/service.ts и два теста.
export * from './core'
export * from './types'
export * from './text'
export * from './pool'

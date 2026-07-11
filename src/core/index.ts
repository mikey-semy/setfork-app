// Ядро домена SetFork. Импортируй отсюда: `import type { List, GitStore } from '@/core'`.
// Правило: core НЕ зависит от features/shared/app/Drizzle/Next. См. docs/architecture.md.
export * from './domain/access'
export * from './domain/affiliate'
export * from './domain/entities'
export * from './domain/quiz'
export * from './ports'

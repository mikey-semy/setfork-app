// Слаги/теги переехали в shared/lib/slug (нужны не только library: генерация, MCP, петля
// ухода). Здесь остался ре-экспорт — существующие импорты продолжают работать.
export { parseTags, slugify, uniqueSlug } from '@/shared/lib/slug'

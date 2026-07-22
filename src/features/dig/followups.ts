// Парсинг NEXT/SUMMON переехал в дом гномов (shared/ai/reply-parse) — единый
// источник правды. Здесь реэкспорт для существующих импортов из features/dig.
export { parseFollowups, parseSummon } from '@/shared/ai/reply-parse'

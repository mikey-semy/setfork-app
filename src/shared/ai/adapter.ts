import 'server-only'
import type { AiPort } from '@/core'
import { embedOne } from './embeddings'

// Адаптер порта AiPort (пока только embed; generate/refine — при миграции features/generation).
export const aiPort: AiPort = {
  async embed(text) {
    return embedOne(text, 'query') // порт зовётся для поисковых запросов
  },
}

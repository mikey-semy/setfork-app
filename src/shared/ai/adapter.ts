import 'server-only'
import type { AiPort } from '@/core'
import { embedOne } from './embeddings'
import { getAiSettings } from '@/shared/settings/ai'

// Адаптер порта AiPort (пока только embed; generate/refine — при миграции features/generation).
export const aiPort: AiPort = {
  async embed(text) {
    const { embeddingModel } = await getAiSettings()
    return embedOne(text, embeddingModel)
  },
}

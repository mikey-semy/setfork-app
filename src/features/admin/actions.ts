'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/shared/auth/admin'
import { saveSettings } from '@/shared/settings/kv'
import { defaultChatModel, defaultEmbeddingModel } from '@/shared/settings/ai'

export async function setAiSettings(formData: FormData): Promise<void> {
  await requireAdmin()
  const enabled = formData.get('enabled') === 'on'
  const chatModel = String(formData.get('chatModel') ?? '').trim()
  const fallbackModel = String(formData.get('fallbackModel') ?? '').trim()
  const embeddingModel = String(formData.get('embeddingModel') ?? '').trim()
  const temperature = Math.min(2, Math.max(0, Number(formData.get('temperature')) || 0.3))
  const maxTokens = Math.min(4000, Math.max(64, Math.round(Number(formData.get('maxTokens')) || 1500)))
  const cheapModeThreshold = Math.max(0, Number(formData.get('cheapModeThreshold')) || 0)

  await saveSettings({
    'ai.enabled': enabled ? 'true' : 'false',
    'ai.chat_model': chatModel || defaultChatModel(),
    'ai.fallback_model': fallbackModel,
    'ai.embedding_model': embeddingModel || defaultEmbeddingModel(),
    'ai.temperature': String(temperature),
    'ai.max_tokens': String(maxTokens),
    'ai.cheap_mode_threshold': String(cheapModeThreshold),
  })
  revalidatePath('/admin')
}

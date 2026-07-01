import 'server-only'

export interface ModelOption {
  id: string
  name: string
  promptPrice: number // USD / 1M prompt tokens
  completionPrice: number // USD / 1M completion tokens
}

interface RawModel {
  id: string
  name?: string
  pricing?: { prompt?: string; completion?: string }
}

function toOptions(raw: RawModel[] | undefined): ModelOption[] {
  return (raw ?? [])
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      promptPrice: (Number(m.pricing?.prompt) || 0) * 1_000_000,
      completionPrice: (Number(m.pricing?.completion) || 0) * 1_000_000,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Каталог чат-моделей OpenRouter (с ценами) для выпадающих списков в админке. */
export async function fetchChatModels(): Promise<ModelOption[]> {
  const key = process.env.OPENROUTER_API_KEY
  const base = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1'
  const init = key ? { headers: { Authorization: `Bearer ${key}` } } : undefined
  try {
    const res = await fetch(`${base}/models`, init)
    if (!res.ok) return []
    const data = (await res.json()) as { data?: RawModel[] }
    return toOptions(data.data)
  } catch {
    return []
  }
}

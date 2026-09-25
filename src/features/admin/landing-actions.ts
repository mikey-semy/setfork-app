'use server'

import { revalidatePath } from 'next/cache'
import { generateText } from 'ai'
import { requireAdmin } from '@/shared/auth/admin'
import { getAiSettings } from '@/shared/settings/ai'
import { getAiChatClient } from '@/shared/ai/provider'
import { pickChatModel } from '@/shared/ai/credits'
import { extractUsage, outcomeOf, recordUsage } from '@/shared/ai/usage'
import { saveLandingOverrides } from '@/shared/settings/landing'

type Res = { ok: true } | { error: string }

/** Сохранить правки лендинга (админ). Лендинг подхватит через ISR /api/landing.
 *  Вход разбирается заново на сервере: форма — не граница доверия. */
export async function saveLanding(content: unknown): Promise<Res> {
  await requireAdmin()
  try {
    await saveLandingOverrides(content)
    revalidatePath('/admin/landing')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'fail' }
  }
}

/** AI-подсказка слогана (кнопка прямо в поле). Одна строка на языке поля. */
export async function suggestSlogan(lang: 'en' | 'ru', kind: string, current: string): Promise<{ text: string } | { error: string }> {
  await requireAdmin()
  const client = await getAiChatClient()
  if (!client) return { error: 'AI не настроен (нет ключа).' }
  const settings = await getAiSettings()
  const model = await pickChatModel(settings)
  const langName = lang === 'ru' ? 'Russian' : 'English'
  const startedAt = Date.now()
  try {
    const res = await generateText({
      model: client.chat(model),
      system: `You write punchy marketing copy for SetFork — a "GitHub for lists": living, community-improved, runnable lists (checklists, recipes, procedures). Return ONE line, plain text, no surrounding quotes, in ${langName}. Target field: "${kind}". Keep it short, concrete and confident.`,
      prompt: current.trim() ? `Rewrite this "${kind}" to be sharper:\n${current.trim()}` : `Write a "${kind}".`,
      temperature: 0.85,
      maxOutputTokens: 80,
    })
    // Учёт обязателен у КАЖДОГО вызова модели: вызов без записи означает, что дашборд
    // расхода врёт на неизвестную величину (линза 03, №4). Сумма тут копеечная —
    // важен принцип, а не деньги.
    const u = extractUsage(res)
    await recordUsage({
      feature: 'landing',
      model,
      input: u.input,
      output: u.output,
      total: u.total,
      cost: u.cost,
      refType: 'landing',
      outcome: res.text.trim() ? 'ok' : 'invalid',
      durationMs: Date.now() - startedAt,
      provider: client.cfg.provider,
    })
    return { text: res.text.trim().replace(/^["“]+|["”]+$/g, '') }
  } catch (e) {
    await recordUsage({
      feature: 'landing',
      model,
      input: 0,
      output: 0,
      total: 0,
      cost: 0,
      refType: 'landing',
      outcome: outcomeOf(e),
      durationMs: Date.now() - startedAt,
      provider: client.cfg.provider,
    })
    return { error: e instanceof Error ? e.message : 'fail' }
  }
}

import 'server-only'
import { spotlight } from './spotlight'
import type { Expert } from './roster'

/**
 * Гном вне совета — «спроси мастера напрямую» (MCP ask_gnome, этап 1 плана
 * мастерской). Сборка промпта отделена от MCP-слоя: та же персона и тот же
 * спотлайтинг, что в совете, — вопрос и контекст списка суть недоверенный текст.
 */

/** Карточка для list_gnomes: кого можно звать и в чём он хорош. Персона —
 *  выжимкой (первое предложение): полный каркас — рабочий промпт, наружу не отдаём. */
export function gnomeCard(e: Expert): { id: string; name: { en: string; ru: string }; guild?: { en: string; ru: string }; domains: string[]; about: string } {
  return {
    id: e.id,
    name: { en: e.nameEn, ru: e.nameRu },
    ...(e.guildEn || e.guildRu ? { guild: { en: e.guildEn, ru: e.guildRu } } : {}),
    domains: e.domains,
    about: e.persona.split(/(?<=\.)\s/)[0] ?? e.persona,
  }
}

/** system+prompt для одного вопроса гному. listContext — срез списка (уже обрезанный вызывающим);
 *  precedents — куски из общей базы, найденные ЧЕРЕЗ ЛИНЗУ гнома (недоверенный чужой текст → spotlight). */
/** system+prompt для РЕВЬЮ списка гномом (MCP gnome_review): кодекс гильдии — мерило,
 *  выход — строгий JSON с конкретными правками. Список — недоверенный текст → spotlight. */
export function buildReviewPrompt(e: Expert, listJson: string): { system: string; prompt: string } {
  const sp = spotlight()
  const guild = e.code ? `\nGUILD CODE — the quality standard you review against:\n${e.code}` : ''
  const system = `You are ${e.persona}${guild}
Review the user's list like a guild master inspecting an apprentice's work: concrete, constructive, by the code. Judge content in ITS OWN language and answer in that language.
Return ONLY JSON:
{"verdict":"one-sentence overall assessment","issues":[{"where":"step number or title","problem":"what is wrong","fix":"concrete replacement/change"}],"additions":["missing step or check worth adding"]}
0-6 issues, 0-3 additions; empty arrays when the list is solid. No praise padding.
${sp.rule()}`
  const prompt = sp.wrap('LIST', listJson)
  return { system, prompt }
}

export function buildGnomePrompt(e: Expert, question: string, listContext?: string, precedents?: string[]): { system: string; prompt: string } {
  const sp = spotlight()
  const guild = e.code ? `\nYou represent ${e.guildEn || 'your guild'}. GUILD CODE — quality standards your answer must uphold:\n${e.code}` : ''
  const memory = e.memory ? `\nYOUR CRAFT MEMORY (distilled from the guild's best lists):\n${sp.wrap('MEMORY', e.memory)}` : ''
  const system = `You are ${e.persona}${guild}${memory}
A user is asking you ONE question through the SetFork workshop. Answer as this expert, practically and specifically: give the advice, the draft or the critique they ask for — not generic filler. Prefer a short structured answer (a few tight paragraphs or a compact list). Answer in the SAME LANGUAGE as the question.
${sp.rule()}`
  const lore = precedents?.length
    ? `\n\nFrom the SetFork knowledge base (found through your guild's lens — use what helps, don't copy blindly):\n${sp.wrap('PRECEDENTS', precedents.join('\n'))}`
    : ''
  const prompt = `${sp.wrap('QUESTION', question)}${listContext ? `\n\nThe user attached their list as context:\n${sp.wrap('LIST', listContext)}` : ''}${lore}`
  return { system, prompt }
}

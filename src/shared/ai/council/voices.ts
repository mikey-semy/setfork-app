import 'server-only'
import { gnomeMood, gnomeReputation, gnomeThanksCounts } from '../gnome-reputation'
import { gnomeCard, rivalryHints } from '../gnome-character'
import { voiceLine, type VoiceKind } from '../voice'
import type { Expert } from '../roster'
import type { Lang } from '@/shared/i18n'
import { firstJson, type CouncilRunner } from './call'

/** Реплика говорящего к событию витка; null — голоса нет, зовущий подставит текст сайта. */
export type CouncilVoice = (who: string, kind: VoiceKind, vars?: Record<string, string>) => string | null

/**
 * Голоса гномов: ОДИН flash-вызов шлифует реплики на весь совет и не блокирует его.
 *
 * Статичные голоса (voice.ts) детерминированы по seed витка и всегда доступны; шлифовка
 * лишь заменяет их живым текстом ПО ТЕМЕ, когда успевает. Стартует до первого этапа: к
 * поздним стадиям (черновики, критика, синтез) реплики почти всегда готовы, ранние берут
 * статику — это нормальный исход, а не сбой.
 *
 * События с переменными (`{names}`/`{n}`) тоже шлифуются: модель оставляет токен в тексте,
 * подстановка идёт здесь — иначе созыв и поиск вечно оставались бы на статике и заметно
 * повторялись (фидбек владельца про «робота»).
 */
export function startCouncilVoices(ctx: {
  run: CouncilRunner
  /** Быстрая модель: шлифовка — это украшение, платить за неё большой моделью незачем. */
  fast: string
  experts: Expert[]
  lang: Lang
  langName: string
  topic: string
  /** Seed витка: реплики одной попытки детерминированы, между попытками разные. */
  seed: string
  /** Правило spotlight — тема пришла от пользователя и в промпте обёрнута. */
  spotlightRule: string
}): CouncilVoice {
  const { run, fast, experts, lang, langName, topic, seed, spotlightRule } = ctx
  let polished: Record<string, string> | null = null

  void (async () => {
    try {
      const events = [
        'planner:plan-single',
        'planner:plan-council',
        'reporter:clarify',
        'crier:summon', // с токеном {names} — подставим созванных
        'seek-lists:seek', // с токеном {n} — число прецедентов
        ...experts.map((e) => `${e.id}:draft`),
        'innovator:innovate',
        'critic:critique',
        'elder:synth',
      ]
      // Character cards (одушевление, HQ §3): каждый гном — РАЗНЫЙ. Карточка =
      // «семя» стиля (трейт+тик+эмодзи), из которого модель генерит СВЕЖУЮ реплику
      // (few-shot по research: не показываем статику дословно — она «робот»).
      // + НАСТРОЕНИЕ (RPG-развитие): демеанор из послужного списка гнома — часто
      // отклоняют → ворчливый, часто принимают → окрылённый. Реальный сигнал в стиль.
      const [moodRep, thanksN] = await Promise.all([gnomeReputation(), gnomeThanksCounts()])
      const whoIds = ['planner', 'reporter', 'innovator', 'critic', 'elder', ...experts.map((e) => e.id)]
      const cards = whoIds
        .map((id) => {
          const c = gnomeCard(id)
          const mood = gnomeMood(moodRep, id, thanksN[id] ?? 0).style
          return `${id}: ${c.trait}; тик — ${c.quirk}; эмодзи ${c.emoji}${mood ? `; настроение сейчас — ${mood}` : ''}`
        })
        .join('\n')
      const res = await run(
        fast,
        `You voice a gnome-workshop council working on the topic. Each gnome has a DISTINCT character (cards below). Write ONE opening line for each event key "who:kind" — what THAT gnome says as its step starts.
RULES: make every line UNMISTAKABLY that gnome — show emotion, humor and their quirk, never a dry status report; a good workshop banters. In 1-2 lines let a gnome throw a GOOD-NATURED jab at a rival per the rivalries below (playful, never mean) — it makes the council memorable. VARY the wording freely every time (never a stock phrase); tie it to the topic naturally. An emoji fits SOME lines (≤1 per line, not every line). Max 90 characters, no quotes. Language: ${langName}.
For "crier:summon" put the literal token {names} where the summoned gnomes are named. For "seek-lists:seek" put the literal token {n} where the count of found precedents goes.
CHARACTERS:
${cards}
RIVALRIES (playful, for banter):
${rivalryHints()}
Return ONLY a JSON object mapping every event key to its line.\n${spotlightRule}`,
        `TOPIC: ${topic}\nKEYS:\n${events.join('\n')}`,
        800,
      )
      if (res) {
        const obj = JSON.parse(firstJson(res.text)) as Record<string, unknown>
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 90)
        if (Object.keys(out).length) polished = out
      }
    } catch {
      // статичные голоса — нормальный фолбэк
    }
  })()

  return (who, kind, vars) => {
    let line = polished?.[`${who}:${kind}`]
    if (line && vars) for (const [k, v] of Object.entries(vars)) line = line.replaceAll(`{${k}}`, v)
    return line ?? voiceLine(who, kind, lang, seed, vars)
  }
}

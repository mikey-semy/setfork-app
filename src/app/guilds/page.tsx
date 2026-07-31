import type { Metadata } from 'next'
import { Award } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { getRoster, rosterAvatars } from '@/shared/ai/roster'
import { gnomeRank, gnomeReputation, REP_MIN_GENS } from '@/features/generation/reputation'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'

// Стиль бейджа ранга по tier: выше — заметнее. Ученик (0) — приглушённо (стартовый
// ранг, не «пусто»); Старший мастер (3) — самый выразительный. Только токены темы.
const RANK_CLS = [
  'text-muted', // 0 Ученик
  'border border-border text-ink-2', // 1 Подмастерье
  'bg-(--accent-soft) text-accent', // 2 Мастер
  'border border-(--accent) bg-(--accent-soft) text-accent', // 3 Старший мастер
]

/**
 * Публичная витрина гильдий (HQ §7 «гильдии наружу»): кто куёт списки SetFork,
 * по каким кодексам и насколько их предложениям доверяют. Часть мира продукта —
 * репутация через прозрачность, не через обещания.
 */
export const metadata: Metadata = { title: 'Guilds' }
export const revalidate = 300 // витрина меняется медленно (ростер+репутация)

export default async function GuildsPage() {
  const lang = await getLang()
  const ru = lang === 'ru'
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументами (i18n-lint)
  const [roster, avatars, rep] = await Promise.all([getRoster(), rosterAvatars(), gnomeReputation()])

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6">
      <h1 className="text-[22px] font-bold text-ink">{say('The Workshop Guilds', 'Гильдии мастерской')}</h1>
      <p className="mt-1.5 max-w-[640px] text-[14px] leading-relaxed text-ink-2">
        {say(
          'Every SetFork list is forged by a council of masters. Each master carries his guild — its code of quality and its reputation, earned list by list.',
          'Каждый список SetFork куёт совет мастеров. За каждым — его гильдия: кодекс качества и репутация, заработанная список за списком.',
        )}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {roster.map((e) => {
          const r = rep[e.id]
          const share = r && r.gens >= REP_MIN_GENS ? Math.round((r.accepted / r.gens) * 100) : null
          // Видимый ранг (профразвитие): цеховой титул по объёму принятых списков.
          const rank = gnomeRank(rep, e.id)
          return (
            <div key={e.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center gap-3">
                <GnomeAvatar src={avatars[e.id] || `/gnomes/${e.avatar || e.id}.webp`} size={56} className="size-14 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold text-ink">{ru ? e.nameRu : e.nameEn}</div>
                  {(ru ? e.guildRu : e.guildEn) && <div className="text-[12.5px] font-medium text-accent">{ru ? e.guildRu : e.guildEn}</div>}
                  {/* Ранг — цеховой титул (RPG-прогрессия на глазах). Иконка-медаль с
                      подмастерья; ученик — приглушённый текст без иконки. */}
                  <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${RANK_CLS[rank.tier]}`} title={say('Craft rank — earned by lists people built from this master', 'Цеховой ранг — заработан списками, что люди собрали из черновиков мастера')}>
                    {rank.tier >= 1 && <Award size={11} />}
                    {ru ? rank.labelRu : rank.labelEn}
                  </span>
                </div>
                {share !== null && (
                  <span className="ml-auto shrink-0 self-start rounded-full bg-(--accent-soft) px-2 py-0.5 text-[11px] font-semibold text-accent" title={say('Share of councils whose list was accepted', 'Доля советов, чей список приняли')}>
                    ✓ {share}%
                  </span>
                )}
              </div>
              {e.code && (
                <div className="mt-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{say('Guild code', 'Кодекс гильдии')}</div>
                  <p className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-ink-2">{e.code}</p>
                </div>
              )}
              {e.domains.length > 0 && !e.domains.includes('*') && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {e.domains.map((d) => (
                    <span key={d} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-2">
                      {d}
                    </span>
                  ))}
                </div>
              )}
              {e.domains.includes('*') && <div className="mt-3 text-[11px] text-muted">{say('Any topic', 'Любая тема')}</div>}
              {r && r.gens > 0 && (
                <div className="mt-3 text-[11px] text-muted">
                  {say(`Councils joined: ${r.gens}`, `Участие в советах: ${r.gens}`)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

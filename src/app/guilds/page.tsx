import type { Metadata } from 'next'
import { Award } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getRoster, rosterAvatars } from '@/shared/ai/roster'
import { gnomeRank, gnomeReputation, REP_MIN_GENS } from '@/features/generation/reputation'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'
import { Tooltip } from '@/shared/ui/Tooltip'
import { PAGE } from '@/shared/ui/control'
import { cardClass } from '@/shared/ui/card-style'

// Стиль бейджа ранга по tier: выше — заметнее. Ученик (0) — приглушённо (стартовый
// ранг, не «пусто»); Старший мастер (3) — самый выразительный. Только токены темы.
const RANK_CLS = [
  'text-muted', // 0 Ученик
  'border border-border text-ink-2', // 1 Подмастерье
  'bg-accent-soft text-accent', // 2 Мастер
  'border border-accent bg-accent-soft text-accent', // 3 Старший мастер
]

/**
 * Публичная витрина гильдий (HQ §7 «гильдии наружу»): кто куёт списки SetFork,
 * по каким кодексам и насколько их предложениям доверяют. Часть мира продукта —
 * репутация через прозрачность, не через обещания.
 */
export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang()
  return { title: t('guildsTitle', lang) }
}
export const revalidate = 300 // витрина меняется медленно (ростер+репутация)

export default async function GuildsPage() {
  const lang = await getLang()
  const ru = lang === 'ru'
  // Портреты резолвит rosterAvatars по реальным файлам public/gnomes: нет
  // файла → замысел из констант → пусто (заглушка GnomeAvatar без 404).
  const [roster, avatars, rep] = await Promise.all([getRoster(), rosterAvatars(), gnomeReputation()])

  return (
    <div className={PAGE}>
      <h1 className="text-stat font-bold text-ink">{t('guilds.theWorkshopGuilds', lang)}</h1>
      <p className="mt-1.5 max-w-[40rem] text-body-lg leading-relaxed text-ink-2">
        {t('guilds.everySetforkListForged', lang)}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {roster.map((e) => {
          const r = rep[e.id]
          const share = r && r.gens >= REP_MIN_GENS ? Math.round((r.accepted / r.gens) * 100) : null
          // Видимый ранг (профразвитие): цеховой титул по объёму принятых списков.
          const rank = gnomeRank(rep, e.id)
          return (
            <div key={e.id} className={cardClass()}>
              <div className="flex items-center gap-3">
                <GnomeAvatar src={avatars[e.id]} size={56} className="size-14 shrink-0" />
                <div className="min-w-0">
                  <div className="text-title font-semibold text-ink">{ru ? e.nameRu : e.nameEn}</div>
                  {(ru ? e.guildRu : e.guildEn) && <div className="text-body-sm font-medium text-accent">{ru ? e.guildRu : e.guildEn}</div>}
                  {/* Ранг — цеховой титул (RPG-прогрессия на глазах). Иконка-медаль с
                      подмастерья; ученик — приглушённый текст без иконки.
                      tabIndex: Radix Tooltip открывается по focus — тап на touch
                      фокусирует бейдж и показывает подсказку (Codex #643). */}
                  <Tooltip label={t('guilds.craftRankEarnedBy', lang)}>
                    <span tabIndex={0} className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold ${RANK_CLS[rank.tier]}`}>
                      {rank.tier >= 1 && <Award size={11} />}
                      {ru ? rank.labelRu : rank.labelEn}
                    </span>
                  </Tooltip>
                </div>
                {share !== null && (
                  <Tooltip label={t('guilds.shareCouncilsWhoseList', lang)}>
                    <span tabIndex={0} className="ml-auto shrink-0 self-start rounded-full bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">
                      ✓ {share}%
                    </span>
                  </Tooltip>
                )}
              </div>
              {e.code && (
                <div className="mt-3">
                  <div className="mb-1 text-caption font-semibold uppercase tracking-wide text-muted">{t('common.guildCode', lang)}</div>
                  {/* Людям — на их языке; агентам в промпты всегда едет EN `code` (вердикт владельца, линза 07). */}
                  <p className="whitespace-pre-wrap text-body-sm leading-[1.55] text-ink-2">{ru ? e.codeRu || e.code : e.code}</p>
                </div>
              )}
              {e.domains.length > 0 && !e.domains.includes('*') && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {e.domains.map((d) => (
                    <span key={d} className="rounded-full border border-border px-2 py-0.5 text-caption text-ink-2">
                      {d}
                    </span>
                  ))}
                </div>
              )}
              {e.domains.includes('*') && <div className="mt-3 text-caption text-muted">{t('guilds.anyTopic', lang)}</div>}
              {r && r.gens > 0 && (
                <div className="mt-3 text-caption text-muted">
                  {t('guilds.councilsJoined', lang).replace('{n}', String(r.gens))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

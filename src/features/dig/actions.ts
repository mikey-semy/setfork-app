'use server'

import { and, asc, eq } from 'drizzle-orm'
import { db, digLayers, steps, templates, templateVersions } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/core'
import { generateDigLayer, DIG_MAX_LEVEL } from '@/shared/ai/dig'
import { aiQuota, globalBudgetOk } from '@/shared/quota'
import { getAiSettings, isAiAvailable } from '@/shared/settings/ai'
import { rateLimit } from '@/shared/rate-limit'
import { tr, type Lang, type LocaleText } from '@/shared/i18n'

/**
 * «Копать глубже» (HQ §8): выкопать СЛЕДУЮЩИЙ слой под шагом. Шахта общая:
 * слой пишется в dig_layers и виден всем следующим читателям бесплатно —
 * платит токенами только первопроходец. Остановки встроены в UX: один клик =
 * один слой, авто-копания нет.
 */

export interface DigLayerRow {
  level: number
  content: string
}

const DIG_RATE_PER_MIN = 6

export async function digDeeper(
  templateId: string,
  stepN: number,
  lang: Lang,
): Promise<{ layers: DigLayerRow[] } | { error: string }> {
  const session = await requireSession()

  const tpl = await db.query.templates.findFirst({ where: eq(templates.id, templateId) })
  if (!tpl || !canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) return { error: 'not found' }

  // Бюджетная лестница — как у ask_gnome: фича включена → глобальный кап → квота → свой лимит.
  if (!(await isAiAvailable()) || !(await getAiSettings()).enabled) return { error: 'ai_off' }
  if (!(await globalBudgetOk())) return { error: 'budget' }
  if (!(await aiQuota(session.userId, session.handle)).ok) return { error: 'quota' }
  const rl = await rateLimit(`dig:${session.userId}`, DIG_RATE_PER_MIN, 60_000)
  if (!rl.ok) return { error: 'ratelimited' }

  const existing = await db
    .select({ level: digLayers.level, content: digLayers.content })
    .from(digLayers)
    .where(and(eq(digLayers.templateId, templateId), eq(digLayers.version, tpl.currentVersion), eq(digLayers.stepN, stepN), eq(digLayers.lang, lang)))
    .orderBy(asc(digLayers.level))
  const nextLevel = (existing[existing.length - 1]?.level ?? 0) + 1
  if (nextLevel > DIG_MAX_LEVEL) return { layers: existing }

  // Шаг текущей версии по n — источник правды для раскопки.
  const [ver] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.version, tpl.currentVersion)))
  const [row] = ver
    ? await db.select().from(steps).where(and(eq(steps.versionId, ver.id), eq(steps.n, stepN))).limit(1)
    : []
  if (!row || row.type !== 'step') return { error: 'not found' }

  const generated = await generateDigLayer(
    {
      listTitle: tr(tpl.title as LocaleText, lang),
      stepTitle: tr(row.title as LocaleText, lang),
      stepDesc: tr(row.desc as LocaleText, lang),
      stepWhy: tr(row.why as LocaleText, lang),
      command: row.command ?? '',
    },
    existing.map((l) => l.content),
    nextLevel,
    lang,
    { userId: session.userId, templateId },
  )
  if (!generated) return { error: 'aifail' }

  // Гонка двух копателей на один уровень: уникальный индекс + DoNothing — выигравший слой остаётся.
  await db
    .insert(digLayers)
    .values({
      templateId,
      version: tpl.currentVersion,
      stepN,
      level: nextLevel,
      lang,
      content: generated.content,
      provenance: { model: generated.model, provider: generated.provider, basedOnLevels: existing.map((l) => l.level) },
      createdBy: session.userId,
    })
    .onConflictDoNothing()

  const layers = await db
    .select({ level: digLayers.level, content: digLayers.content })
    .from(digLayers)
    .where(and(eq(digLayers.templateId, templateId), eq(digLayers.version, tpl.currentVersion), eq(digLayers.stepN, stepN), eq(digLayers.lang, lang)))
    .orderBy(asc(digLayers.level))
  return { layers }
}

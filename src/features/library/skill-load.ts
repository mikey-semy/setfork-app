import 'server-only'
import { getLang } from '@/shared/i18n/server'
import type { Lang } from '@/shared/i18n'
import { appOrigin } from '@/shared/auth/app-origin'
import { captureError, log } from '@/shared/observability'
import { and, eq } from 'drizzle-orm'
import { db, releases } from '@/shared/db'
import { requireViewableDetail } from './guard'
import { getVersionSteps } from './queries'
import { toExportList, type ExportList } from './export'
import { versionShaMap } from './version-sha'
import { latestReport } from './verification-report'
import { skillBodyOverflow, type SkillContext } from './skill'
import { resolveAssetFiles } from './skill-assets'
import type { AuthoredFile, GitCore } from '@/core'

/**
 * ВСЁ, ЧТО НУЖНО ОБОИМ АДРЕСАМ СКИЛЛА — `SKILL.md` и `skill.tar.gz`, — одной функцией.
 *
 * Видимость и язык — ТЕ ЖЕ, что у экспорта в markdown (`export/route.ts`): тот же guard
 * по сессии и тот же язык зрителя. Скилл — это тот же список другим файлом, и правило
 * «кто его видит» у двух файлов одного списка разойтись не имеет права. Одна функция на
 * два маршрута по той же причине: разойдись они, один из адресов однажды отдал бы
 * приватный список.
 *
 * Возвращает null, если список не виден, — маршрут отвечает 404, как экспорт.
 */
/** Чем читать авторские файлы версии. Порт, а не импорт ядра: слой `features` не вправе
 *  тянуть `features/git`, поэтому реализацию подставляет маршрут (слой `app`). */
export type AuthoredFilesPort = Pick<GitCore, 'authoredFiles'>

/**
 * `?ref=` → номер версии. Сначала ТЕГ РЕЛИЗА (`v0.7.0`), потом номер версии (`v3`): ядро
 * ставит релизный тег с force, и релиз «v3», указывающий на пятую версию, git читает так
 * же — как пятую. Не нашлось — `null`, маршрут отвечает 404, а не отдаёт вершину: скилл
 * «версии v0.7.0», собранный из текущей, врал бы именно тем, ради чего его просили.
 */
export function resolveSkillRef(ref: string, tags: { tag: string; version: number }[], versions: number[]): number | null {
  const release = tags.find((r) => r.tag === ref)
  if (release) return release.version
  const n = /^v([1-9]\d*)$/.exec(ref)
  return n && versions.includes(Number(n[1])) ? Number(n[1]) : null
}

export async function loadSkill(
  handle: string,
  slug: string,
  git: AuthoredFilesPort,
  ref?: string | null,
): Promise<{ list: ExportList; lang: Lang; ctx: SkillContext } | null> {
  const [lang, found] = await Promise.all([getLang(), requireViewableDetail(handle, slug)])
  if (!found) return null
  const detail = ref ? await atRef(found, ref) : found
  if (!detail) return null

  const version = detail.currentVersion?.version ?? detail.tpl.currentVersion
  // Подпись версии — из ядра и мягко, как в экспорте: отказ ядра не лишает файла.
  const [shaMap, report] = await Promise.all([
    versionShaMap(detail.tpl.id),
    // ⚠️ Отчёт — в ПУБЛИЧНОМ виде (провалы скрыты по решению Р2c): скилл уезжает к чужим
    // агентам, и вид ведущего списка сюда не годится.
    detail.currentVersion ? latestReport(detail.currentVersion.id, false) : Promise.resolve(null),
  ])
  const commitSha = shaMap?.get(version) ?? null
  const authored = await authoredFilesOf(git, handle, slug, version)
  const list = toExportList(detail, commitSha)
  const ctx: SkillContext = {
    // Адрес — из КОНФИГУРАЦИИ: на проде адрес запроса собран из привязки сервера
    // (`0.0.0.0:3000`), и скилл называл бы своим источником его.
    origin: appOrigin(),
    commitSha,
    verification: detail.currentVersion?.verificationLevel ?? null,
    lastRun: report
      ? {
          verdict: report.verdict,
          passed: report.steps.filter((x) => x.status === 'pass').length,
          total: report.steps.length,
          at: report.createdAt,
        }
      : null,
    authored,
    ...(ref ? { ref } : {}),
  }
  return { list, lang, ctx }
}

type Detail = NonNullable<Awaited<ReturnType<typeof requireViewableDetail>>>

/**
 * Список на теге или версии: шаги и строка ТОЙ версии (уровень проверки, отчёт прогона),
 * файлы и подпись коммита следом берутся по её номеру. Название, описание, теги и шапка
 * скилла — текущие: проекция держит их только для вершины, как и страница истории `?v=N`.
 */
async function atRef(detail: Detail, ref: string): Promise<Detail | null> {
  const tags = await db
    .select({ tag: releases.tag, version: releases.version })
    .from(releases)
    .where(and(eq(releases.templateId, detail.tpl.id), eq(releases.tag, ref)))
  const version = resolveSkillRef(
    ref,
    tags,
    detail.tpl.versions.map((v) => v.version),
  )
  if (version === null) return null
  if (version === (detail.currentVersion?.version ?? detail.tpl.currentVersion)) return detail
  const at = await getVersionSteps(detail.tpl.id, version)
  const row = detail.tpl.versions.find((v) => v.version === version)
  if (!at || !row) return null
  return { ...detail, steps: at.steps, currentVersion: row }
}

/**
 * Авторские файлы версии из ядра — МЯГКО, как подпись версии.
 *
 * Ядро не настроено, старое (метода не знает) или недоступно — скилл собирается из
 * блоков, как до ADR-0028. Отказ ядра не должен лишать человека файла; но и молча он не
 * проходит: сбой уходит в журнал, чтобы «архив без скриптов автора» не выглядел нормой.
 */
async function authoredFilesOf(git: AuthoredFilesPort, handle: string, slug: string, version: number): Promise<AuthoredFile[] | null> {
  if (!process.env.SETFORK_CORE_URL) return null
  try {
    const files = await git.authoredFiles({ owner: handle, slug }, version)
    if (!files) return null
    // Двоичные файлы лежат в дереве указателями — в скилл едут их байты из хранилища.
    const { files: resolved, missing } = await resolveAssetFiles(files, { handle, slug, version })
    if (missing.length) log.warn('skill assets missing from storage', { handle, slug, version, missing })
    return resolved
  } catch (e) {
    captureError(e, { where: 'skill.authoredFiles', handle, slug, version })
    return null
  }
}

/** Тело сверх рекомендации стандарта (500 строк) — предупреждение, не отказ. */
export function warnIfLong(markdown: string, handle: string, slug: string): void {
  const over = skillBodyOverflow(markdown)
  if (over > 0) log.warn('SKILL.md longer than the standard advises', { handle, slug, linesOver: over })
}

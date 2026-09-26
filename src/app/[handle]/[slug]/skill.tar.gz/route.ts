import { loadSkill, warnIfLong } from '@/features/library/skill-load'
import { gitCore } from '@/features/git/core'
import { toSkill } from '@/features/library/skill'
import { tarGz } from '@/shared/lib/tar'
import { log } from '@/shared/observability'
import { SKILL_INSTALL_DOWNLOAD_MAX_BYTES } from '@/core/domain/skill-limits'
import { cacheHeaders } from '@/shared/http/cache'
import { problemListNotFound, problemRefNotFound } from '@/shared/http/problem'

/**
 * GET /{handle}/{slug}/skill.tar.gz — список как скилл агента, ПАПКОЙ ЦЕЛИКОМ.
 *
 *   npx skills add https://setfork.com/{handle}/{slug}/skill.tar.gz
 *
 * Внутри одна папка с именем скилла (стандарт требует, чтобы оно совпадало с `name`):
 * `SKILL.md` (шаги и текст на своих местах) и команды списка в
 * `scripts/run.sh` — тот же скрипт, что отдаёт `/raw`. Авторские файлы версии
 * (`scripts/`, `references/`, `assets/` из git-дерева, ADR-0028) ложатся рядом байт в байт.
 *
 * `?ref=v0.7.0` — скилл ТЕГА релиза (или `?ref=v3` — версии): шаги и файлы той версии, а
 * не вершины; неизвестный ref — 404. Файл называется `<имя>-<ref>.tar.gz`, как архив тега у
 * GitHub (`repo-v1.0.tar.gz`); папка внутри — по-прежнему имя скилла (так требует стандарт).
 *
 * Видимость, язык и кеш — как у экспорта в markdown (см. `loadSkill`).
 */
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const ref = new URL(req.url).searchParams.get('ref')
  const loaded = await loadSkill(handle, slug, gitCore, ref)
  if (!loaded) return ref ? problemRefNotFound(ref) : problemListNotFound()

  const skill = toSkill(loaded.list, loaded.lang, loaded.ctx)
  warnIfLong(skill.markdown, handle, slug)
  // Пропуск авторского файла — не молча: в журнал, с путями.
  if (skill.skipped.length) log.warn('skill archive skipped authored files', { handle, slug, skipped: skill.skipped })
  const dirs = [...new Set(skill.files.flatMap((f) => (f.path.includes('/') ? [f.path.slice(0, f.path.lastIndexOf('/') + 1)] : [])))]
  const archive = tarGz([
    { path: `${skill.name}/` },
    ...dirs.map((d) => ({ path: `${skill.name}/${d}` })),
    ...skill.files.map((f) => ({ path: `${skill.name}/${f.path}`, content: f.content, mode: f.executable ? 0o755 : 0o644 })),
  ])
  // Крупнее предела установщика — `npx skills` его не скачает. Пределы записи держат архив
  // ниже; если он всё же вышел больше (например, огромный SKILL.md), — не молча.
  if (archive.length > SKILL_INSTALL_DOWNLOAD_MAX_BYTES) log.warn('skill archive over the npx skills download limit', { handle, slug, bytes: archive.length })
  return new Response(new Uint8Array(archive), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${skill.name}${ref ? `-${ref.replace(/[^A-Za-z0-9._-]/g, '-')}` : ''}.tar.gz"`,
      ...cacheHeaders({ shared: false }),
    },
  })
}

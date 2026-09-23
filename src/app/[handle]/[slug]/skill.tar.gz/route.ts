import { loadSkill, warnIfLong } from '@/features/library/skill-load'
import { gitCore } from '@/features/git/core'
import { toSkill } from '@/features/library/skill'
import { tarGz } from '@/shared/lib/tar'
import { cacheHeaders, noStoreHeaders } from '@/shared/http/cache'

/**
 * GET /{handle}/{slug}/skill.tar.gz — список как скилл агента, ПАПКОЙ ЦЕЛИКОМ.
 *
 *   npx skills add https://setfork.com/{handle}/{slug}/skill.tar.gz
 *
 * Внутри одна папка с именем скилла (стандарт требует, чтобы оно совпадало с `name`):
 * `SKILL.md`, фон из текстовых блоков в `references/context.md` и команды списка в
 * `scripts/run.sh` — тот же скрипт, что отдаёт `/raw`. Авторские файлы версии
 * (`scripts/`, `references/`, `assets/` из git-дерева, ADR-0028) ложатся рядом байт в байт.
 *
 * Видимость, язык и кеш — как у экспорта в markdown (см. `loadSkill`).
 */
export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const loaded = await loadSkill(handle, slug, gitCore)
  if (!loaded) return new Response('Not found', { status: 404, headers: noStoreHeaders() })

  const skill = toSkill(loaded.list, loaded.lang, loaded.ctx)
  warnIfLong(skill.markdown, handle, slug)
  const dirs = [...new Set(skill.files.flatMap((f) => (f.path.includes('/') ? [f.path.slice(0, f.path.lastIndexOf('/') + 1)] : [])))]
  const archive = tarGz([
    { path: `${skill.name}/` },
    ...dirs.map((d) => ({ path: `${skill.name}/${d}` })),
    ...skill.files.map((f) => ({ path: `${skill.name}/${f.path}`, content: f.content, mode: f.executable ? 0o755 : 0o644 })),
  ])
  return new Response(new Uint8Array(archive), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${skill.name}.tar.gz"`,
      ...cacheHeaders({ shared: false }),
    },
  })
}

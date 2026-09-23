import { loadSkill, warnIfLong } from '@/features/library/skill-load'
import { toSkillMarkdown } from '@/features/library/skill'
import { cacheHeaders, noStoreHeaders } from '@/shared/http/cache'

/**
 * GET /{handle}/{slug}/SKILL.md — список как скилл агента, ОДНИМ ФАЙЛОМ.
 *
 *   npx skills add https://setfork.com/{handle}/{slug}/SKILL.md
 *
 * Стандарт Agent Skills (agentskills.io): шапка `name` + `description`, дальше инструкция.
 * Соседних файлов у этого адреса нет, поэтому фон и скрипт сюда не входят — в теле
 * ссылка на полный скилл архивом (`skill.tar.gz`).
 *
 * Видимость, язык и кеш — как у экспорта в markdown (см. `loadSkill`).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const loaded = await loadSkill(handle, slug)
  if (!loaded) return new Response('Not found', { status: 404, headers: noStoreHeaders() })

  const body = toSkillMarkdown(loaded.list, loaded.lang, loaded.ctx)
  warnIfLong(body, handle, slug)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // `inline`: агент и браузер читают файл, а не скачивают его.
      'Content-Disposition': 'inline; filename="SKILL.md"',
      // Как у экспорта: ответ зависит от сессии и языка зрителя, общему кешу он не нужен.
      ...cacheHeaders({ shared: false }),
    },
  })
}

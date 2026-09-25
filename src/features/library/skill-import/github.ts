import 'server-only'
import { fetchPublicUrl } from '@/shared/lib/safe-fetch'

/**
 * СКИЛЛ С GITHUB — SKILL.md, файлы автора и LICENSE одного коммита.
 *
 * Адрес — такой же, какой принимает `npx skills add`: репозиторий, папка скилла или сам
 * SKILL.md (`github.com/o/r`, `…/tree/<ref>/<папка>`, `…/blob/<ref>/<папка>/SKILL.md`,
 * короткое `o/r`). Ходим только к двум хостам GitHub — произвольный адрес сюда не попадает,
 * и запрос не может стать обходом сети сервера.
 *
 * Коммит ЗАКРЕПЛЯЕТСЯ: всё читается по SHA, а не по ветке. Иначе файлы одного импорта могли
 * прийти из разных коммитов (ветку двигают), а «источник» в списке указывал бы на то, чего
 * уже нет. Дерево — одним запросом (`git/trees?recursive=1`): в нём и пути, и режимы, то есть
 * исполняемость `scripts/` приезжает как была.
 */

const API = 'https://api.github.com'
const RAW = 'https://raw.githubusercontent.com'
const TIMEOUT_MS = 15_000
/** Дольше GitHub не ждём: импорт — действие человека у экрана. */
const signal = () => AbortSignal.timeout(TIMEOUT_MS)

export interface GithubSkillRef {
  owner: string
  repo: string
  /** Ветка, тег или SHA; нет — ветка по умолчанию. */
  ref?: string
  /** Папка скилла в репозитории ('' — корень или «найти единственный SKILL.md»). */
  dir: string
}

/** Владелец на GitHub — буквы, цифры и дефис; точка в первом сегменте значит «это хост». */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9_.-]+$/

/** Адрес → репозиторий, ref и папка. Ветки со слешем в имени не поддержаны — называем это. */
export function parseGithubSkillUrl(input: string): GithubSkillRef | { error: string } {
  let s = input.trim().replace(/\/+$/, '')
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '')
  if (s.startsWith('github.com/')) s = s.slice('github.com/'.length)
  else if (/^[^/]*\./.test(s)) return { error: 'only GitHub addresses are imported: github.com/<owner>/<repo>[/tree/<ref>/<folder>]' }
  const parts = s.split('/').filter(Boolean)
  const [owner, rawRepo, kind, ref, ...rest] = parts
  const repo = rawRepo?.replace(/\.git$/, '')
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo)) return { error: 'not a GitHub repository address: expected github.com/<owner>/<repo>' }
  if (!kind) return { owner, repo, dir: '' }
  if ((kind !== 'tree' && kind !== 'blob') || !ref) {
    // Короткая форма «o/r/папка» — как у `npx skills add`.
    return { owner, repo, dir: parts.slice(2).join('/') }
  }
  let dir = rest.join('/')
  if (kind === 'blob') {
    if (!/(^|\/)SKILL\.md$/.test(dir)) return { error: 'a file link must point at SKILL.md' }
    dir = dir.replace(/\/?SKILL\.md$/, '')
  }
  if (dir.split('/').some((p) => p === '..' || p === '.')) return { error: 'bad folder in the address' }
  return { owner, repo, ref, dir }
}

async function api<T>(path: string, token?: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  // Без переадресаций: заголовки переходят на следующий хоп как есть, и токен ушёл бы
  // туда, куда API его переслал бы. У API GitHub для этих вызовов переадресаций нет.
  const res = await fetchPublicUrl(
    `${API}${path}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'setfork-skill-import',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: signal(),
    },
    0,
  ).catch(() => null)
  if (!res) return { ok: false, status: 0 }
  if (!res.ok) return { ok: false, status: res.status }
  return { ok: true, data: (await res.json()) as T }
}

/** Отказ GitHub словами: человеку «403» ничего не скажет. */
function githubError(status: number, what: string): string {
  if (status === 0) return `GitHub did not answer (${what}) — try again`
  if (status === 404) return `not found on GitHub: ${what} (a private repository cannot be imported)`
  if (status === 403 || status === 429) return 'GitHub rate limit reached — try again in an hour'
  return `GitHub answered ${status} for ${what}`
}

interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  size?: number
}

export interface FetchedSkill {
  skillMd: string
  files: { path: string; content: Uint8Array; executable: boolean }[]
  /** Что из папки не взяли и почему — называется человеку, а не теряется молча. */
  skipped: { path: string; why: string }[]
  licenseText: string | null
  /** Закреплённый коммит и адрес папки скилла на нём. */
  sha: string
  sourceUrl: string
}

const AUTHORED_DIRS = ['scripts', 'references', 'assets']
const LICENSE_NAMES = /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i
/**
 * ⚠️ КОПИЯ пределов ядра (setfork-core `serialize.rs`: AUTHORED_MAX_FILES = 50,
 * AUTHORED_MAX_BYTES = 1 МБ). Решает здесь не она — набор судит ядро и откажет само; она
 * только останавливает СКАЧИВАНИЕ заранее: папка с тысячей файлов держала бы действие
 * человека минутами. Разойдутся — ядро всё равно скажет своё.
 */
const FILES_MAX = 50
const BYTES_MAX = 1024 * 1024
/** LICENSE крупнее — не текст лицензии, а что-то иное: считаем неизвестной (закрытой). */
const LICENSE_MAX_BYTES = 200 * 1024

async function raw(ref: GithubSkillRef, sha: string, path: string): Promise<Uint8Array | null> {
  const url = `${RAW}/${ref.owner}/${ref.repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`
  const res = await fetchPublicUrl(url, { headers: { 'user-agent': 'setfork-skill-import' }, signal: signal() }).catch(() => null)
  if (!res?.ok) return null
  return new Uint8Array(await res.arrayBuffer())
}

/** Скилл по адресу: всё одного коммита. Отказ — строкой, с причиной. */
export async function fetchGithubSkill(ref: GithubSkillRef, token?: string): Promise<FetchedSkill | { error: string }> {
  const slug = `${ref.owner}/${ref.repo}`
  let branch = ref.ref
  if (!branch) {
    const info = await api<{ default_branch: string }>(`/repos/${slug}`, token)
    if (!info.ok) return { error: githubError(info.status, slug) }
    branch = info.data.default_branch
  }
  const commit = await api<{ sha: string }>(`/repos/${slug}/commits/${encodeURIComponent(branch)}`, token)
  if (!commit.ok) return { error: githubError(commit.status, `${slug}@${branch}`) }
  const sha = commit.data.sha
  const tree = await api<{ tree: TreeEntry[]; truncated: boolean }>(`/repos/${slug}/git/trees/${sha}?recursive=1`, token)
  if (!tree.ok) return { error: githubError(tree.status, `${slug} tree`) }
  // Усечённое дерево молча теряло бы файлы и LICENSE папки — а без LICENSE вердикт другой.
  if (tree.data.truncated) return { error: `${slug} is too large to read in one go — point at the skill folder in a smaller repository` }
  const blobs = tree.data.tree.filter((e) => e.type === 'blob')

  // Папка не названа, а в корне SKILL.md нет — ищем единственный скилл в репозитории.
  let dir = ref.dir
  if (!blobs.some((b) => b.path === (dir ? `${dir}/SKILL.md` : 'SKILL.md'))) {
    if (dir) return { error: `no SKILL.md in ${slug}/${dir}` }
    const found = blobs.filter((b) => /(^|\/)SKILL\.md$/.test(b.path)).map((b) => b.path.replace(/\/?SKILL\.md$/, ''))
    if (found.length === 0) return { error: `no SKILL.md in ${slug}` }
    if (found.length > 1) {
      return { error: `${slug} holds ${found.length} skills — name one: ${found.slice(0, 10).map((d) => `github.com/${slug}/tree/${branch}/${d}`).join(', ')}` }
    }
    dir = found[0]
  }
  const prefix = dir ? `${dir}/` : ''
  const skillBytes = await raw(ref, sha, `${prefix}SKILL.md`)
  if (!skillBytes) return { error: `could not read ${prefix}SKILL.md from GitHub — try again` }

  const files: FetchedSkill['files'] = []
  const skipped: FetchedSkill['skipped'] = []
  // Сначала — сколько придётся скачать: по дереву, до первого запроса за файлом.
  const wanted = blobs.filter((b) => {
    if (!b.path.startsWith(prefix)) return false
    const [top, ...restPath] = b.path.slice(prefix.length).split('/')
    return AUTHORED_DIRS.includes(top) && restPath.length === 1
  })
  const total = wanted.reduce((n, b) => n + (b.size ?? 0), 0)
  if (wanted.length > FILES_MAX || total > BYTES_MAX) {
    return { error: `the skill has ${wanted.length} files, ${Math.ceil(total / 1024)} KB — a skill holds at most ${FILES_MAX} files and ${BYTES_MAX / 1024} KB` }
  }
  for (const b of blobs) {
    if (!b.path.startsWith(prefix)) continue
    const rel = b.path.slice(prefix.length)
    const [top, ...restPath] = rel.split('/')
    if (!AUTHORED_DIRS.includes(top) || restPath.length === 0) continue
    // Дерево скилла — один уровень: `scripts/a.sh`, но не `scripts/lib/a.sh`.
    if (restPath.length > 1) {
      skipped.push({ path: rel, why: 'in a subfolder — a skill keeps files directly in scripts/, references/, assets/' })
      continue
    }
    const content = await raw(ref, sha, b.path)
    if (!content) return { error: `could not read ${b.path} from GitHub — try again` }
    if (content.includes(0)) {
      skipped.push({ path: rel, why: 'binary — a skill keeps text only' })
      continue
    }
    files.push({ path: rel, content, executable: top === 'scripts' && b.mode === '100755' })
  }

  // LICENSE — папки скилла, иначе корня репозитория (так лежит у большинства).
  const lic =
    blobs.find((b) => b.path.startsWith(prefix) && LICENSE_NAMES.test(b.path.slice(prefix.length))) ??
    blobs.find((b) => !b.path.includes('/') && LICENSE_NAMES.test(b.path))
  const licenseBytes = lic ? ((lic.size ?? 0) > LICENSE_MAX_BYTES ? new TextEncoder().encode('(license file too large to read)') : await raw(ref, sha, lic.path)) : null

  return {
    skillMd: new TextDecoder().decode(skillBytes),
    files,
    skipped,
    licenseText: licenseBytes ? new TextDecoder().decode(licenseBytes) : null,
    sha,
    sourceUrl: `https://github.com/${slug}/tree/${sha}${dir ? `/${dir.split('/').map(encodeURIComponent).join('/')}` : ''}`,
  }
}

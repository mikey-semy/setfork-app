import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { ListWriteError } from '@/core'
import { db, templates, users } from '@/shared/db'
import { listStore } from '@/features/library/list-store'
import { gitCore } from '@/features/git/core'

/**
 * Расхождение git и базы обязано доходить до пишущего НАЗВАННОЙ причиной.
 *
 * Линза ядра 02 §4. Отказ `OutOfSync` был единственным среди отказов записи без
 * причины в трейлере: фронт не мог отличить его от прочих предусловий, и человек
 * получал безымянный сбой, а агент — совет «повторить», который тут не помогает
 * никогда (чинит оператор).
 *
 * Проба настоящая: посторонний тег `v9` кладётся в само репо. Без имени
 * контейнера ядра (ITEST_CORE_CONTAINER) она ПРОПУСКАЕТСЯ, а не притворяется
 * зелёной — на моках это утверждение ничего не доказывает.
 */
const CORE_CT = process.env.ITEST_CORE_CONTAINER
const STAMP = String(Date.now()).slice(-6)
const HANDLE = `oos${STAMP}`

const inCore = (cmd: string) => execFileSync('docker', ['exec', CORE_CT!, 'sh', '-c', cmd], { encoding: 'utf8' }).trim()

const step = (t: string) => ({
  n: 1, type: 'step', content: {}, blockId: null, title: { en: t }, desc: {}, command: '',
  level: 'required', why: {}, needsHuman: false, needsHumanAsk: {}, section: {}, subtasks: [], refs: [], imageRef: null,
})

async function makeList(slug: string, who: string) {
  const handle = `${HANDLE}${who}`
  const [u] = await db
    .insert(users)
    .values({ handle, email: `${handle}@x.dev`, name: 'O' })
    .returning({ id: users.id })
  const list = (await listStore.create({
    ownerId: u.id, slug, title: { en: slug }, desc: {}, tags: [], status: 'published', visibility: 'public', steps: [step('ПЕРВЫЙ')],
  } as never)) as { id: string }
  // Первое обращение материализует репо на диск ядра.
  await gitCore.branchSnapshot({ owner: handle, slug }, 'main').catch(() => null)
  return { id: list.id, ownerId: u.id, handle }
}

describe.runIf(CORE_CT && process.env.SETFORK_CORE_ADDR)('расхождение git и базы', () => {
  it('запись отклоняется НАЗВАННОЙ причиной, а не безымянным сбоем', async () => {
    const slug = `oos-a-${STAMP}`
    const { id, ownerId } = await makeList(slug, 'a')
    // Посторонний тег с именем версии: до починки #59 такое мог занять релиз.
    inCore(`git --git-dir=/data/git/${id}.git tag v9 main`)

    const err = await listStore
      .addVersion(id, { note: 'v2', steps: [step('ВТОРОЙ')], authorId: ownerId } as never)
      .then(() => null)
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ListWriteError)
    expect((err as ListWriteError).code).toBe('out-of-sync')
    // Отказ — предусловие, а не гонка: путать их нельзя, у них разный совет человеку.
    expect((err as ListWriteError).code).not.toBe('stale')

    const [row] = await db.select({ v: templates.currentVersion }).from(templates).where(eq(templates.id, id))
    expect(row.v, 'отказ ничего не записал').toBe(1)
  })

  it('репо без главной ветки лечится, а не отдаёт пустоту навсегда', async () => {
    const slug = `oos-b-${STAMP}`
    const { id, handle } = await makeList(slug, 'b')
    const repo = `/data/git/${id}.git`
    inCore(`rm -f ${repo}/refs/heads/main; sed -i '/refs\\/heads\\/main/d' ${repo}/packed-refs 2>/dev/null || true`)
    expect(inCore(`ls ${repo}/refs/heads 2>/dev/null || true`), 'main действительно снесён').toBe('')

    const snap = await gitCore.branchSnapshot({ owner: handle, slug }, 'main')

    expect(snap, 'снимок вернулся, а не null').toBeTruthy()
    expect(inCore(`git --git-dir=${repo} rev-parse --verify main`), 'ветка восстановлена').toMatch(/^[0-9a-f]{40}$/)
  })
})

// Импорт ops-чек-листов ЧЕРЕЗ MCP (демонстрация agent-flow): настоящий MCP-клиент
// подключается к /api/mcp/mcp и вызывает инструмент create_list — как это делала бы
// нейросеть. Запуск: npx tsx scripts/mcp-import-ops.ts  (dev-сервер должен быть поднят)
//
// Что делает: (1) минтит временный write-токен для demo, (2) MCP connect → listTools →
// create_list по каждому списку, (3) публикует созданные черновики (create_list делает
// draft), (4) удаляет временный токен. Не деструктивно для остального.
import 'dotenv/config'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { db, apiTokens, templates, users } from '../src/shared/db'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const ENDPOINT = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/api/mcp'

type Item = { title: string; desc?: string; command?: string }
type List = { title: string; desc: string; ordered?: boolean; tags: string[]; items: Item[] }

const LISTS: List[] = [
  {
    title: 'Postgres container security audit',
    desc: 'Quick hardening pass over Dockerized PostgreSQL: exposure, version, miner/process check, logs, roles.',
    ordered: false,
    tags: ['security', 'postgres', 'docker', 'audit'],
    items: [
      { title: 'Find running Postgres containers', command: "docker ps --format '{{.ID}} {{.Image}}' | grep postgres" },
      { title: 'Check for ports exposed to the world', desc: '0.0.0.0 means reachable from the internet — bind to 127.0.0.1 instead.', command: 'docker port ${CONTAINER}   # any 0.0.0.0:* mapping is dangerous' },
      { title: 'Check the Postgres version', desc: 'Old majors miss security fixes — plan an upgrade if behind.', command: 'docker exec ${CONTAINER} psql --version' },
      { title: 'Scan for crypto-miner / suspicious processes', command: "docker exec ${CONTAINER} ps aux | grep -E 'kinsing|kdevtmpfsi|xmrig|minerd' | grep -v grep" },
      { title: 'Look for executables in /tmp', command: 'docker exec ${CONTAINER} find /tmp -type f -executable' },
      { title: 'Scan recent logs for errors', command: "docker logs ${CONTAINER} 2>&1 | grep -iE 'error|fatal|unauthorized|failed' | tail -5" },
      { title: 'Review roles and pg_hba', desc: 'Check for weak/blank passwords and overly-open host rules.', command: "docker exec ${CONTAINER} psql -U postgres -c '\\\\du'" },
    ],
  },
  {
    title: 'Docker auto-cleanup via cron',
    desc: 'Schedule nightly Docker cleanup and periodic disk monitoring with cron.',
    ordered: true,
    tags: ['docker', 'ops', 'cron', 'disk'],
    items: [
      { title: 'Make the helper scripts executable', command: 'chmod +x ~/docker-cleanup.sh ~/disk-monitor.sh' },
      { title: 'Create the log files', command: 'touch /var/log/docker-cleanup.log /var/log/disk-monitor.log && chmod 644 /var/log/docker-cleanup.log /var/log/disk-monitor.log' },
      { title: 'Remove any old matching cron entries', desc: 'Idempotent — drops previous docker-cleanup/disk-monitor lines first.', command: "crontab -l 2>/dev/null | grep -v 'docker-cleanup\\|disk-monitor' | crontab -" },
      {
        title: 'Add the cron jobs',
        desc: 'Cleanup nightly at 03:00, disk check every 6 hours.',
        command: `( crontab -l 2>/dev/null
  echo '0 3 * * * ~/docker-cleanup.sh >> /var/log/docker-cleanup.log 2>&1'
  echo '0 */6 * * * ~/disk-monitor.sh >> /var/log/disk-monitor.log 2>&1'
) | crontab -`,
      },
      { title: 'Verify the crontab', command: "crontab -l | grep -E 'docker-cleanup|disk-monitor'" },
    ],
  },
]

async function main() {
  const [demo] = await db.select({ id: users.id }).from(users).where(eq(users.handle, 'demo'))
  if (!demo) throw new Error('demo user not found — run npm run db:seed first')

  // Идемпотентность: убираем прошлые версии этих списков (иначе create_list добавит -1/-2).
  const targetSlugs = ['postgres-container-security-audit', 'docker-auto-cleanup-via-cron']
  await db.delete(templates).where(and(eq(templates.ownerId, demo.id), inArray(templates.slug, targetSlugs)))

  // (1) временный write-токен
  const raw = randomBytes(24).toString('hex')
  const token = 'sf_' + raw
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const [tok] = await db
    .insert(apiTokens)
    .values({ userId: demo.id, name: 'mcp-import (temp)', tokenHash, prefix: `sf_${raw.slice(0, 6)}…`, scope: 'write' })
    .returning()
  console.log(`Minted temp write token for demo (${tok.prefix}).`)

  const created: string[] = []
  try {
    // (2) MCP connect
    const client = new Client({ name: 'ops-importer', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
    await client.connect(transport)
    const tools = await client.listTools()
    console.log(`Connected to ${ENDPOINT}. Tools: ${tools.tools.map((t) => t.name).join(', ')}`)

    // create_list по каждому списку
    for (const l of LISTS) {
      const res = await client.callTool({
        name: 'create_list',
        arguments: { title: l.title, desc: l.desc, ordered: l.ordered ?? true, tags: l.tags, items: l.items },
      })
      const text = Array.isArray(res.content) && res.content[0]?.type === 'text' ? res.content[0].text : JSON.stringify(res)
      let ref = ''
      try {
        ref = JSON.parse(text).ref ?? ''
      } catch {
        /* оставим text как есть */
      }
      if (ref) created.push(ref.split('/')[1])
      console.log(`  ✓ create_list → ${ref || text}`)
    }
    await client.close()
  } finally {
    // (4) убираем временный токен
    await db.delete(apiTokens).where(eq(apiTokens.id, tok.id))
    console.log('Temp token removed.')
  }

  // (3) create_list делает draft — публикуем, чтобы можно было листать как остальные
  if (created.length) {
    await db
      .update(templates)
      .set({ status: 'published' })
      .where(and(eq(templates.ownerId, demo.id), inArray(templates.slug, created)))
    console.log(`Published ${created.length} draft(s): ${created.join(', ')}`)
  }
  console.log('Done.')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

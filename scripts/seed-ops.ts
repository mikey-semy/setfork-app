// Аддитивный сид: несколько обезличенных ops/devops-чек-листов для пользователя `demo`.
// Запуск: npx tsx scripts/seed-ops.ts
// НЕ деструктивный: удаляет только шаблоны demo с этими конкретными slug'ами (идемпотентно),
// остальную БД не трогает. Владелец — demo (появятся в его «My lists»), public + published.
import 'dotenv/config'
import { and, eq } from 'drizzle-orm'
import { db, steps, templateVersions, templates, users } from '../src/shared/db'

type Step = { t: string; d?: string; c?: string }
type List = { slug: string; title: string; desc: string; tags: string[]; ordered?: boolean; steps: Step[] }

const LISTS: List[] = [
  {
    slug: 'fail2ban-ssh-hardening',
    title: 'Fail2ban SSH brute-force protection',
    desc: 'Install and configure Fail2ban to ban repeated SSH auth failures on a Linux server.',
    tags: ['security', 'ssh', 'fail2ban', 'linux'],
    steps: [
      { t: 'Check if Fail2ban is already running', d: 'Skip the install if the service is already active.', c: 'systemctl is-active --quiet fail2ban && fail2ban-client version || echo "not installed"' },
      { t: 'Install Fail2ban', d: 'Debian/Ubuntu package.', c: 'apt update -qq && apt install -y fail2ban' },
      {
        t: 'Write the local jail config',
        d: 'Ban for 1h after 5 failures in 10 min; stricter for SSH (3 tries → 2h). Uncomment destemail for alerts.',
        c: `cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
# destemail = you@example.com
# sender   = Fail2Ban
# action   = %(action_mwl)s

[sshd]
enabled  = true
port     = ssh
logpath  = /var/log/auth.log
maxretry = 3
bantime  = 7200
EOF`,
      },
      { t: 'Enable on boot and (re)start', c: 'systemctl enable fail2ban && systemctl restart fail2ban' },
      { t: 'Verify the SSH jail is active', d: 'You should see the sshd jail and the currently banned IPs.', c: 'fail2ban-client status && fail2ban-client status sshd' },
      { t: 'Know the day-to-day commands', d: 'Unban with: fail2ban-client set sshd unbanip <IP>. Tail logs with: tail -f /var/log/fail2ban.log', c: 'fail2ban-client status sshd' },
    ],
  },
  {
    slug: 'ufw-docker-swarm-manager',
    title: 'UFW firewall for a Docker Swarm manager',
    desc: 'Lock down a Swarm manager node with UFW: deny inbound by default, open SSH/HTTP/HTTPS, and allow Swarm ports only from the worker.',
    tags: ['security', 'firewall', 'ufw', 'docker', 'swarm'],
    steps: [
      { t: 'Reset and set default policy', d: 'Deny all inbound, allow all outbound. Pass your worker node IP as WORKER_IP.', c: 'ufw --force reset && ufw default deny incoming && ufw default allow outgoing' },
      { t: 'Allow SSH FIRST (critical)', d: "Do this before enabling UFW or you'll lock yourself out.", c: "ufw allow 22/tcp comment 'SSH access'" },
      { t: 'Allow HTTP and HTTPS', c: "ufw allow 80/tcp comment 'HTTP' && ufw allow 443/tcp comment 'HTTPS'" },
      {
        t: 'Allow Swarm ports from the worker only',
        d: '2377 (management), 7946 tcp+udp (node comms), 4789 udp (overlay network). Uses ${WORKER_IP}.',
        c: `ufw allow from "\${WORKER_IP}" to any port 2377 proto tcp comment 'Swarm mgmt'
ufw allow from "\${WORKER_IP}" to any port 7946 proto tcp comment 'Swarm comms tcp'
ufw allow from "\${WORKER_IP}" to any port 7946 proto udp comment 'Swarm comms udp'
ufw allow from "\${WORKER_IP}" to any port 4789 proto udp comment 'Swarm overlay'`,
      },
      { t: 'Enable UFW and review', d: 'Open a SECOND SSH session to confirm access before closing the first one.', c: 'ufw --force enable && ufw status verbose' },
    ],
  },
  {
    slug: 'emergency-docker-disk-cleanup',
    title: 'Emergency Docker disk cleanup',
    desc: 'Reclaim space fast on a Docker host when the root filesystem is critically full (≥85%). Destructive — removes all unused images/volumes.',
    tags: ['docker', 'ops', 'disk', 'incident'],
    steps: [
      { t: 'Check current usage', d: 'Confirm it is actually critical (≥85%) before the aggressive prune.', c: "df -h / && docker system df" },
      { t: 'Remove stopped containers', c: 'docker container prune -f' },
      { t: 'Remove ALL unused images', d: 'No time filter — everything not attached to a running container.', c: 'docker image prune -a -f' },
      { t: 'Remove ALL unused volumes', d: '⚠ Deletes data in dangling volumes. Make sure nothing important is unmounted.', c: 'docker volume prune -f' },
      { t: 'Prune networks and build cache', c: 'docker network prune -f && docker builder prune -a -f' },
      { t: 'Full system prune', c: 'docker system prune -a -f' },
      { t: 'Trim large old container logs', d: 'JSON logs over 10 MB, older than 7 days.', c: 'find /var/lib/docker/containers/ -name "*-json.log" -type f -size +10M -mtime +7 -delete' },
      { t: 'Re-check and find the biggest offenders', d: 'If still ≥85%, inspect the largest Docker directories manually.', c: 'df -h / && du -sh /var/lib/docker/* 2>/dev/null | sort -hr | head -10' },
    ],
  },
]

async function main() {
  const [demo] = await db.select({ id: users.id }).from(users).where(eq(users.handle, 'demo'))
  if (!demo) {
    console.error('demo user not found — seed the base library first (npm run db:seed)')
    process.exit(1)
  }
  for (const l of LISTS) {
    await db.delete(templates).where(and(eq(templates.ownerId, demo.id), eq(templates.slug, l.slug)))
    const [tpl] = await db
      .insert(templates)
      .values({
        ownerId: demo.id,
        slug: l.slug,
        title: { en: l.title },
        desc: { en: l.desc },
        tags: l.tags,
        currentVersion: 1,
        origin: 'authored',
        status: 'published',
        visibility: 'public',
        moderation: 'active',
        ordered: l.ordered ?? true,
      })
      .returning()
    const [ver] = await db
      .insert(templateVersions)
      .values({ templateId: tpl.id, version: 1, note: 'imported from ops scripts (anonymized)' })
      .returning()
    await db.insert(steps).values(
      l.steps.map((s, i) => ({
        versionId: ver.id,
        n: i + 1,
        title: { en: s.t },
        desc: { en: s.d ?? '' },
        command: s.c ?? '',
        subtasks: [],
        refs: [],
      })),
    )
    console.log(`  ✓ demo/${l.slug} (${l.steps.length} steps)`)
  }
  console.log(`Done: ${LISTS.length} ops lists for demo.`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

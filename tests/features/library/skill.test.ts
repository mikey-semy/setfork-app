import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toRunnableScript, type ExportList, type ExportStep } from '@/features/library/export'
import {
  SKILL_DESCRIPTION_MAX,
  skillBodyOverflow,
  skillDescription,
  skillName,
  toSkill,
  toSkillMarkdown,
  type SkillContext,
} from '@/features/library/skill'
import { tarGz } from '@/shared/lib/tar'
import { parseSkillMd } from '@/features/library/skill-parse'
import { pickSkillHeader } from '@/core/domain/skill-header'
import { parse as parseYaml } from 'yaml'

/**
 * СПИСОК КАК СКИЛЛ АГЕНТА — по стандарту Agent Skills (agentskills.io/specification).
 *
 * Стандарт строг к шапке: имя 1–64 знака из `a-z0-9-`, без дефиса по краям и без двух
 * подряд, и оно обязано совпасть с именем папки; описание непустое и не длиннее 1024.
 * Нарушение любого из этих правил — и агент скилл не загрузит, а мы об этом не узнаем:
 * ставится он у чужого человека. Поэтому правила проверены здесь, на обеих сторонах.
 */

const ORIGIN = 'https://setfork.test'
const ctx: SkillContext = { origin: ORIGIN }

const step = (over: Partial<ExportStep> = {}): ExportStep => ({
  n: 1,
  title: { ru: 'Шаг' },
  desc: {},
  command: '',
  level: 'required',
  why: {},
  subtasks: [],
  refs: [],
  ...over,
})
const text = (md: string, section = ''): ExportStep => step({ type: 'text', title: {}, content: { md }, section: { ru: section } })

const list = (over: Partial<ExportList> = {}): ExportList => ({
  title: { ru: 'Отказ веб-сервиса' },
  desc: { ru: 'Порядок действий при недоступности сервиса' },
  tags: [],
  ordered: true,
  version: 3,
  ownerHandle: 'miki',
  slug: 'otkaz-veb-servisa',
  steps: [step()],
  ...over,
})

/** Шапка `SKILL.md` → поля. Значения пишутся JSON-строками, их и разбираем. */
function frontmatter(md: string): { name: string; description: string; metadata: Record<string, string>; keys: string[] } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md)
  if (!m) throw new Error('no frontmatter')
  const keys: string[] = []
  const metadata: Record<string, string> = {}
  let name = ''
  let description = ''
  for (const line of m[1].split('\n')) {
    const nested = /^ {2}([a-z0-9-]+): (.*)$/.exec(line)
    if (nested) {
      metadata[nested[1]] = JSON.parse(nested[2])
      continue
    }
    const top = /^([a-z-]+):(?: (.*))?$/.exec(line)
    if (!top) throw new Error(`bad frontmatter line: ${line}`)
    keys.push(top[1])
    if (top[1] === 'name') name = JSON.parse(top[2])
    if (top[1] === 'description') description = JSON.parse(top[2])
  }
  return { name, description, metadata, keys }
}

/** Правило имени из спецификации — отдельно от нашей реализации, чтобы не проверять её ей же. */
const SPEC_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
const specName = (n: string) => n.length >= 1 && n.length <= 64 && SPEC_NAME.test(n)

describe('имя скилла', () => {
  it.each([
    ['дефис на конце — настоящий слаг с прода', 'skripty-obsluzhivaniya-servera-chto-est-chto-delaet-i-kogda-', 'skripty-obsluzhivaniya-servera-chto-est-chto-delaet-i-kogda'],
    ['два дефиса подряд', 'deploy--nextjs', 'deploy-nextjs'],
    ['дефис в начале', '-deploy', 'deploy'],
    ['кириллица транслитерируется, а не вырезается', 'проверка-сервера', 'proverka-servera'],
    ['заглавные и чужие знаки', 'Deploy_Next.JS', 'deploy-next-js'],
  ])('%s', (_name, slug, expected) => {
    expect(skillName(slug)).toBe(expected)
    expect(specName(skillName(slug)), 'имя нарушает стандарт — агент скилл не загрузит').toBe(true)
  })

  it('длиннее 64 — обрезается, и обрез не оставляет дефис на конце', () => {
    const slug = `${'a'.repeat(63)}-bbbb`
    const name = skillName(slug)
    expect(name.length).toBeLessThanOrEqual(64)
    expect(specName(name), `имя ${name} нарушает стандарт`).toBe(true)
  })

  // ⚠️ Обратная сторона: правильное имя трогать нельзя — оно совпадает с адресом списка,
  // и человек узнаёт скилл по нему.
  // ⚠️ Имя из одних цифр — законный слаг («1984»), но голым значением YAML читает его
  // числом, и имя перестаёт совпадать с папкой у того, кто ставит скилл.
  it('имя в шапке — строка в кавычках, даже из одних цифр', () => {
    const md = toSkill(list({ slug: '1984' }), 'ru', ctx).markdown
    expect(md, 'имя «1984» прочтётся числом').toContain('\nname: "1984"\n')
  })

  it('валидный слаг не меняется', () => {
    expect(skillName('otkaz-veb-servisa-poryadok-reagirovaniya')).toBe('otkaz-veb-servisa-poryadok-reagirovaniya')
  })

  it('слаг из одних знаков — всё равно валидное имя, а не пустота', () => {
    expect(specName(skillName('---'))).toBe(true)
  })
})

describe('описание', () => {
  it('берётся описание списка', () => {
    expect(skillDescription(list(), 'ru')).toBe('Порядок действий при недоступности сервиса')
  })

  it('пустое описание — название, а не пустая строка', () => {
    expect(skillDescription(list({ desc: {} }), 'ru'), 'пустое описание стандарт отвергает').toBe('Отказ веб-сервиса')
  })

  it('длинное режется до 1024 знаков по границе слова', () => {
    // ⚠️ Слова не должны быть префиксами друг друга: у «слово2» и «слово25» разрез посреди
    // второго давал первое, и проверка «разрез по границе» оставалась зелёной на порче.
    const long = Array.from({ length: 400 }, (_, i) => `слово${i}конец`).join(' ')
    const d = skillDescription(list({ desc: { ru: long } }), 'ru')
    expect(Array.from(d).length).toBeLessThanOrEqual(SKILL_DESCRIPTION_MAX)
    const lastWord = d.replace(/…$/, '').split(' ').pop()!
    expect(long.split(' '), 'разрез прошёл посреди слова').toContain(lastWord)
  })

  it('переводы строк сворачиваются: описание — одна строка шапки', () => {
    expect(skillDescription(list({ desc: { ru: 'первая\n\nвторая' } }), 'ru')).toBe('первая вторая')
  })
})

describe('SKILL.md по стандарту', () => {
  it('имя в шапке совпадает с именем папки', () => {
    const skill = toSkill(list({ slug: 'skripty-obsluzhivaniya-servera-chto-est-chto-delaet-i-kogda-' }), 'ru', ctx)
    expect(frontmatter(skill.markdown).name, 'стандарт требует имя = папка').toBe(skill.name)
  })

  it('без шапки исходника — только поля стандарта; своей лицензии SetFork не выдумывает', () => {
    const fm = frontmatter(toSkill(list(), 'ru', ctx).markdown)
    expect(fm.keys).toEqual(['name', 'description', 'metadata'])
  })

  it('шапка исходника возвращается: license, compatibility, allowed-tools, metadata автора — первой', () => {
    const header = { license: 'Apache-2.0', compatibility: 'Needs git', 'allowed-tools': 'Bash(git:*)', metadata: { author: 'Ann: "the" one' } }
    const md = toSkill(list({ skillHeader: header }), 'ru', ctx).markdown
    const fm = parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(md)![1]) as Record<string, unknown> & { metadata: Record<string, string> }
    expect(Object.keys(fm)).toEqual(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'])
    expect(fm.license).toBe('Apache-2.0')
    expect(fm['allowed-tools']).toBe('Bash(git:*)')
    expect(Object.keys(fm.metadata)).toEqual(['author', 'setfork-ref', 'setfork-url', 'setfork-version'])
    expect(fm.metadata.author).toBe('Ann: "the" one')
    // Круг: шапка, прочитанная обратно, — та же, что хранилась.
    expect(pickSkillHeader(parseSkillMd(md).header).header).toEqual(header)
  })

  it('заголовок тела — авторский, если скилл пришёл с другим; в шапку он не попадает', () => {
    const md = toSkill(list({ skillHeader: { heading: 'Whole-repository review' } }), 'ru', ctx).markdown
    expect(md).toMatch(/\n# Whole-repository review\n/)
    expect(frontmatter(md).keys).not.toContain('heading')
  })

  it('ключи metadata, которые YAML прочёл бы не строкой, — в кавычках', () => {
    const md = toSkill(list({ skillHeader: { metadata: { '1.0': 'a', '1': 'b', null: 'c', 'has space': 'd', plain: 'e' } } }), 'ru', ctx).markdown
    const fm = parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(md)![1]) as { metadata: Record<string, string> }
    expect(fm.metadata).toMatchObject({ '1.0': 'a', '1': 'b', null: 'c', 'has space': 'd', plain: 'e' })
    expect(md).toContain('  plain: "e"')
  })

  it('чужой setfork-* в сохранённой шапке не подменяет живой', () => {
    const md = toSkill(list({ skillHeader: { metadata: { 'setfork-version': '1' } } }), 'ru', ctx).markdown
    expect(frontmatter(md).metadata['setfork-version']).toBe('3')
    // И ключ один: дубль строгий YAML (им читает `npx skills`) не разберёт вовсе.
    expect(md.match(/setfork-version:/g)).toHaveLength(1)
  })

  it('metadata — строки: ссылка, канон, версия, подпись, проверка, прогон', () => {
    const at = new Date('2026-09-20T10:00:00Z')
    const fm = frontmatter(
      toSkill(list(), 'ru', { origin: ORIGIN, commitSha: 'abc123', verification: 'machine_run', lastRun: { verdict: 'works', passed: 11, total: 12, at } })
        .markdown,
    )
    expect(fm.metadata).toEqual({
      'setfork-ref': 'miki/otkaz-veb-servisa',
      'setfork-url': `${ORIGIN}/miki/otkaz-veb-servisa`,
      'setfork-version': '3',
      'setfork-sha': 'abc123',
      'setfork-verification': 'machine_run',
      'setfork-last-run': 'works 11/12 2026-09-20T10:00:00.000Z',
    })
  })

  // Подписи нет у списков до git-слоя; «нет» пишется отсутствием строки, а не пустым
  // значением: машина прочла бы пустое как подпись со значением «».
  it('нет подписи и прогона — нет и строк', () => {
    const fm = frontmatter(toSkill(list(), 'ru', ctx).markdown)
    expect(Object.keys(fm.metadata)).toEqual(['setfork-ref', 'setfork-url', 'setfork-version'])
  })

  it('кавычки и двоеточия в описании не ломают шапку', () => {
    const fm = frontmatter(toSkill(list({ desc: { ru: 'Шаг: «проверить» "всё"' } }), 'ru', ctx).markdown)
    expect(fm.description).toBe('Шаг: «проверить» "всё"')
  })

  it('шаг — пункт инструкции: зачем, команда, проверки, ссылки', () => {
    const md = toSkill(
      list({
        steps: [
          step({
            title: { ru: 'Проверить сеть' },
            why: { ru: 'чтобы отсечь класс причин' },
            command: 'ping -c1 host',
            subtasks: [{ ru: 'ответ пришёл' }],
            refs: [{ label: { ru: 'man ping' }, url: 'https://man.example/ping' }],
          }),
        ],
      }),
      'ru',
      ctx,
    ).markdown
    expect(md).toContain('1. **Проверить сеть**')
    expect(md).toContain('Why: чтобы отсечь класс причин')
    expect(md).toContain('ping -c1 host')
    expect(md).toContain('- [ ] ответ пришёл')
    expect(md).toContain('[man ping](https://man.example/ping)')
  })

  // ⚠️ SKILL.md агент исполняет как инструкцию. Разрушительный пункт в скрипте рядом
  // закомментирован — здесь он обязан быть так же явно помечен, а не лежать обычным `sh`.
  it('разрушительный шаг помечен и не подан как исполняемый блок sh', () => {
    const md = toSkill(list({ steps: [step({ title: { ru: 'Почистить' }, command: 'rm -rf /var/lib/app' })] }), 'ru', ctx).markdown
    expect(md, 'агент получил rm -rf обычным шагом').toMatch(/DESTRUCTIVE \(\w+\) — do not run this without explicit confirmation/)
    expect(md, 'опасная команда подана блоком sh').not.toMatch(/```sh\n\s*rm -rf/)
    expect(md, 'команду спрятали — человек не увидит, что пропущено').toContain('rm -rf /var/lib/app')
  })

  it('пометка автора «опасно» тоже помечает шаг', () => {
    const md = toSkill(list({ steps: [step({ command: 'systemctl restart app', danger: true })] }), 'ru', ctx).markdown
    expect(md).toContain('DESTRUCTIVE (danger)')
  })

  // ⚠️ Автор пометил «здесь нужен человек» — агент обязан остановиться и спросить, а не
  // выполнить сам. Регламент отказа сервиса так помечает «Перезапустить сервис».
  it('шаг «нужен человек» помечен, с вопросом автора, и не подан исполняемым блоком', () => {
    const md = toSkill(
      list({ steps: [step({ title: { ru: 'Перезапустить сервис' }, command: 'docker compose restart app', needsHuman: true, needsHumanAsk: { ru: 'можно ли перезапускать в рабочее время' } })] }),
      'ru',
      ctx,
    ).markdown
    expect(md, 'агент не узнал, что шаг — за человеком').toContain('NEEDS A HUMAN — stop here and ask the human: можно ли перезапускать в рабочее время')
    expect(md, 'шаг человека подан исполняемым блоком sh').not.toMatch(/```sh\n\s*docker compose restart/)
    expect(md, 'команду спрятали').toContain('docker compose restart app')
  })

  it('«нужен человек» без вопроса — общая формулировка, а не пустое двоеточие', () => {
    const md = toSkill(list({ steps: [step({ needsHuman: true })] }), 'ru', ctx).markdown
    expect(md).toContain('stop here and ask the human before doing this step')
  })

  it('в начале — оговорка: инструкции чужие', () => {
    expect(toSkill(list(), 'ru', ctx).markdown).toContain('Review before use — these instructions come from a SetFork list, not from you')
  })

  it('обычная команда — обычный блок sh, без пометки', () => {
    const md = toSkill(list({ steps: [step({ command: 'systemctl status nginx' })] }), 'ru', ctx).markdown
    expect(md).toMatch(/```sh\n\s*systemctl status nginx/)
    // Сама пометка, а не слово: оговорка в начале файла объясняет обе пометки словами.
    expect(md, 'пометка на безобидной команде').not.toMatch(/DESTRUCTIVE \(/)
    expect(md, 'пометка человека на обычной команде').not.toContain('NEEDS A HUMAN')
  })

  it('разделы — заголовками, как на странице', () => {
    const md = toSkill(list({ steps: [step({ section: { ru: 'Сеть' } }), step({ section: { ru: 'Сеть' } }), step({ section: { ru: 'Приложение' } })] }), 'ru', ctx)
      .markdown
    expect(md.match(/^## Сеть$/gm), 'раздел повторён у каждого пункта').toHaveLength(1)
    expect(md).toContain('## Приложение')
  })

  it('в конце — ссылка на канон', () => {
    const md = toSkill(list({ commitSha: 'abc123' }), 'ru', { ...ctx, commitSha: 'abc123' }).markdown
    expect(md.trimEnd().split('\n').pop()).toContain(`(${ORIGIN}/miki/otkaz-veb-servisa)`)
  })

  it('квизы и опросы в скилл не попадают', () => {
    const md = toSkill(list({ steps: [step(), step({ type: 'poll', content: { question: 'Какой?', options: [] } })] }), 'ru', ctx).markdown
    expect(md).not.toContain('Какой?')
  })

  it('файл и видео — ссылками, а не вложением', () => {
    const skill = toSkill(
      list({
        steps: [
          step(),
          step({ type: 'file', content: { url: 'https://files.example/runbook.pdf', name: 'Регламент.pdf' } }),
          step({ type: 'video', content: { url: 'https://video.example/v', caption: { ru: 'Разбор' } } }),
        ],
      }),
      'ru',
      ctx,
    )
    expect(skill.files.map((f) => f.path)).toEqual(['SKILL.md'])
    expect(skill.markdown).toContain('[Регламент.pdf](https://files.example/runbook.pdf)')
    expect(skill.markdown).toContain('[Разбор](https://video.example/v)')
  })

  // Адрес из блока идёт в чужого агента — опасная схема не должна доехать ссылкой.
  it('ссылка со схемой javascript: не проходит — ни у файла, ни у шага', () => {
    const md = toSkill(
      list({
        steps: [
          step({ refs: [{ label: { ru: 'ловушка' }, url: 'javascript:alert(2)' }] }),
          step({ type: 'file', content: { url: 'javascript:alert(1)', name: 'x' } }),
        ],
      }),
      'ru',
      ctx,
    ).markdown
    expect(md).not.toContain('javascript:')
    expect(md, 'подпись ссылки пропала вместе с адресом').toContain('- ловушка')
  })

  it('картинка — подписью, а не вложением', () => {
    const skill = toSkill(list({ steps: [step(), step({ type: 'image', content: { ref: 'uploads/x.png', caption: 'Схема' } })] }), 'ru', ctx)
    expect(skill.files.map((f) => f.path)).toEqual(['SKILL.md'])
    expect(skill.markdown).toContain('Схема')
  })
})

describe('текст — в SKILL.md на своих местах («блоки — правда, экспорт верный»)', () => {
  const commitics = list({
    steps: [text('**Кадр 1.** Фелипе не может запустить тест.'), text('**Кадр 2.** Том показывает дверь.'), step({ title: { ru: 'Читать exports' }, section: { ru: 'Что это значит для нас' } })],
  })

  it('текстовые блоки — в SKILL.md, в порядке списка, до шага своего раздела', () => {
    const md = toSkill(commitics, 'ru', ctx).markdown
    const at = (s: string) => md.indexOf(s)
    expect(at('Фелипе не может запустить тест'), 'история потерялась').toBeGreaterThan(0)
    expect(at('Фелипе')).toBeLessThan(at('Том показывает дверь'))
    expect(at('Том показывает дверь')).toBeLessThan(at('## Что это значит для нас'))
    expect(at('## Что это значит для нас')).toBeLessThan(at('Читать exports'))
  })

  it('references/context.md больше не собирается и не упоминается', () => {
    const skill = toSkill(commitics, 'ru', ctx)
    expect(skill.files.map((f) => f.path)).not.toContain('references/context.md')
    expect(skill.markdown).not.toContain('context.md')
  })

  it('текст в разделе — под заголовком раздела, как на странице', () => {
    const md = toSkill(list({ steps: [text('Сначала прочтите.', 'Подготовка'), step({ title: { ru: 'Шаг' }, section: { ru: 'Подготовка' } })] }), 'ru', ctx).markdown
    expect(md.indexOf('## Подготовка')).toBeLessThan(md.indexOf('Сначала прочтите.'))
    expect(md.split('## Подготовка').length, 'раздел повторён').toBe(2)
  })

  it('круг «экспорт → разбор» сохраняет блоки: соседние тексты не сливаются', () => {
    const parsed = parseSkillMd(toSkillMarkdown(commitics, 'ru', ctx))
    expect(parsed.items.map((b) => b.type ?? 'step')).toEqual(['text', 'text', 'step'])
    expect(parsed.items[0].text).toContain('Фелипе')
    expect(parsed.items[1].text).toContain('Том показывает дверь')
    expect(parsed.items[2]).toMatchObject({ title: 'Читать exports', section: 'Что это значит для нас' })
  })

  it('текст, который разбор понял бы иначе, возвращается тем же блоком: граница только там, где нужна', () => {
    const risky = list({
      steps: [
        text('- [docs](https://x.example)\n- [api](https://y.example)'), // первым — как перечень файлов автора
        text('Порядок:\n\n1. сначала это\n2. потом то'), // стали бы шагами
        text('## Не раздел\nа строка текста'), // стал бы разделом
        step({ title: { ru: 'Шаг' } }),
        text('    отступ сразу после шага'), // ушёл бы в шаг
        text('Обычный абзац.'),
      ],
    })
    const md = toSkillMarkdown(risky, 'ru', ctx)
    const parsed = parseSkillMd(md)
    const texts = risky.steps.filter((b) => b.type === 'text').map((b) => String((b.content as { md: string }).md).trim())
    expect(parsed.items.filter((b) => b.type === 'text').map((b) => b.text)).toEqual(texts)
    expect(parsed.items.map((b) => b.type ?? 'step')).toEqual(['text', 'text', 'text', 'step', 'text', 'text'])
    // Второй круг ничего не меняет.
    expect(toSkillMarkdown(risky, 'ru', ctx)).toBe(md)
  })

  it('скилл, пришедший чужим SKILL.md, возвращается без наших границ', () => {
    const src = ['---', 'name: pdf', 'description: d', '---', '# PDF', '', 'Works through pypdf.', '', '1. **Install** it once', '', '## Notes', '', 'Keep it simple.'].join('\n')
    const parsed = parseSkillMd(src)
    const back = list({
      steps: parsed.items.map((b) =>
        b.type === 'text' ? text(b.text!, b.section ?? '') : step({ title: { ru: b.title! }, section: { ru: b.section ?? '' } }),
      ),
    })
    expect(toSkillMarkdown(back, 'ru', ctx)).not.toContain('setfork:text')
  })

  it('однофайловый SKILL.md без скрипта и файлов — без ссылок наружу, текст на месте', () => {
    const md = toSkillMarkdown(commitics, 'ru', ctx)
    expect(md).not.toContain('](references/')
    expect(md).not.toContain('skill.tar.gz')
    expect(md).toContain('Фелипе')
  })

  it('однофайловый SKILL.md списка без фона и скрипта архив не рекламирует', () => {
    expect(toSkillMarkdown(list(), 'ru', ctx)).not.toContain('skill.tar.gz')
  })
})

describe('scripts/run.sh', () => {
  const withCommands = list({ steps: [step({ command: 'systemctl status nginx' }), step({ n: 2, command: 'rm -rf /var/cache/app' })] })

  it('байт в байт тот же скрипт, что отдаёт /raw', () => {
    const run = toSkill(withCommands, 'ru', ctx).files.find((f) => f.path === 'scripts/run.sh')
    expect(run?.content, 'скилл собрал свой скрипт, отличный от /raw').toBe(
      toRunnableScript(withCommands, 'ru', `${ORIGIN}/miki/otkaz-veb-servisa/raw`, 'sh'),
    )
    expect(run?.executable).toBe(true)
  })

  it('список без команд — scripts/ нет вовсе', () => {
    const skill = toSkill(list(), 'ru', ctx)
    expect(skill.files.some((f) => f.path.startsWith('scripts/'))).toBe(false)
    expect(skill.markdown).not.toContain('scripts/')
  })
})

describe('архив', () => {
  /** Распаковать системным tar — тем же, чем распакует человек. */
  function extract(buf: Buffer): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'skill-'))
    const file = join(dir, 'skill.tar.gz')
    writeFileSync(file, buf)
    const out = join(dir, 'out')
    execFileSync('mkdir', ['-p', out])
    execFileSync('tar', ['-xzf', file, '-C', out])
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const p = join(d, f)
        return statSync(p).isDirectory() ? walk(p) : [relative(out, p)]
      })
    return walk(out).sort()
  }

  it('распаковывается в ровно ожидаемые пути под папкой с именем скилла', () => {
    const skill = toSkill(list({ steps: [text('фон'), step({ command: 'echo hi' })] }), 'ru', ctx)
    const paths = extract(
      tarGz([
        { path: `${skill.name}/` },
        ...skill.files.map((f) => ({ path: `${skill.name}/${f.path}`, content: f.content, mode: f.executable ? 0o755 : 0o644 })),
      ]),
    )
    expect(paths).toEqual([`${skill.name}/SKILL.md`, `${skill.name}/scripts/run.sh`].sort())
    expect(paths.some((p) => p.includes('..'))).toBe(false)
  })

  it('содержимое доезжает байт в байт, включая кириллицу', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-'))
    writeFileSync(join(dir, 'a.tgz'), tarGz([{ path: 'x/' }, { path: 'x/SKILL.md', content: 'Проверить сеть — ✓' }]))
    execFileSync('tar', ['-xzf', join(dir, 'a.tgz'), '-C', dir])
    expect(readFileSync(join(dir, 'x/SKILL.md'), 'utf8')).toBe('Проверить сеть — ✓')
  })

  it('исполняемый скрипт распаковывается исполняемым', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-'))
    writeFileSync(join(dir, 'a.tgz'), tarGz([{ path: 'x/' }, { path: 'x/run.sh', content: 'echo', mode: 0o755 }]))
    execFileSync('tar', ['-xzf', join(dir, 'a.tgz'), '-C', dir])
    expect(statSync(join(dir, 'x/run.sh')).mode & 0o111, 'скрипт потерял право на запуск').not.toBe(0)
  })

  it.each([['../evil'], ['/etc/passwd'], ['a/../../b'], ['a//b'], ['']])('путь %j в архив не пишется', (path) => {
    expect(() => tarGz([{ path, content: 'x' }])).toThrow(/unsafe path/)
  })

  it('одинаковый вход — одинаковые байты', () => {
    const entries = [{ path: 'x/' }, { path: 'x/SKILL.md', content: 'a' }]
    expect(tarGz(entries).equals(tarGz(entries))).toBe(true)
  })
})

describe('длина тела', () => {
  it('сверх 500 строк — число лишних, до — ноль', () => {
    expect(skillBodyOverflow('a\n'.repeat(10))).toBe(0)
    expect(skillBodyOverflow('a\n'.repeat(600))).toBeGreaterThan(0)
  })
})

/**
 * АВТОРСКИЕ ФАЙЛЫ ИЗ GIT-ДЕРЕВА (ADR-0028). Их не генерирует никто: `scripts/`, `references/`,
 * `assets/` приходят пушем, и архив обязан отдать их ровно теми байтами, что покрыты SHA
 * версии, — иначе скилл со своими скриптами ставился бы без них.
 */
describe('авторские файлы версии', () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  const authored = (files: Array<[string, string, boolean?]>) =>
    files.map(([path, text, executable]) => ({ path, content: enc(text), executable: executable ?? false }))

  it('ложатся в архив байтами из дерева, исполняемые — исполняемыми', () => {
    const skill = toSkill(list(), 'ru', { ...ctx, authored: authored([['scripts/deploy.sh', '#!/bin/sh\necho deploy\n', true], ['assets/template.md', '# шаблон\n']]) })
    const deploy = skill.files.find((f) => f.path === 'scripts/deploy.sh')
    expect(deploy, 'авторский скрипт не доехал до архива').toBeTruthy()
    expect(new TextDecoder().decode(deploy!.content as Uint8Array)).toBe('#!/bin/sh\necho deploy\n')
    expect(deploy!.executable, 'скрипт потерял право на запуск').toBe(true)
    expect(skill.files.map((f) => f.path)).toContain('assets/template.md')
  })

  it('SKILL.md перечисляет их ссылками — иначе агент о них не узнает', () => {
    const md = toSkill(list(), 'ru', { ...ctx, authored: authored([['scripts/deploy.sh', 'x'], ['references/why.md', 'y']]) }).markdown
    expect(md).toContain('- [scripts/deploy.sh](scripts/deploy.sh)')
    expect(md).toContain('- [references/why.md](references/why.md)')
  })

  // ⚠️ Решение автора главнее: его `scripts/run.sh` заменяет сгенерированный, и строки
  // «все команды одним скриптом» быть не должно — про авторский файл это неправда.
  it('авторский scripts/run.sh заменяет сгенерированный, и SKILL.md не врёт про него', () => {
    const skill = toSkill(list({ steps: [step({ command: 'make build' })] }), 'ru', { ...ctx, authored: authored([['scripts/run.sh', 'echo mine\n', true]]) })
    const runs = skill.files.filter((f) => f.path === 'scripts/run.sh')
    expect(runs, 'в архиве два файла с одним путём').toHaveLength(1)
    expect(new TextDecoder().decode(runs[0].content as Uint8Array), 'сгенерированный затёр авторский').toBe('echo mine\n')
    expect(skill.markdown, 'авторский скрипт выдан за «все команды»').not.toContain('All commands as one script')
  })

  it('авторский references/context.md едет как есть, текст блоков — в SKILL.md', () => {
    const skill = toSkill(list({ steps: [text('фон из блоков'), step()] }), 'ru', { ...ctx, authored: authored([['references/context.md', 'мой фон\n']]) })
    const ctxFiles = skill.files.filter((f) => f.path === 'references/context.md')
    expect(ctxFiles).toHaveLength(1)
    expect(new TextDecoder().decode(ctxFiles[0].content as Uint8Array)).toBe('мой фон\n')
    expect(skill.markdown).not.toContain('Background and the reasoning')
    expect(skill.markdown).toContain('фон из блоков')
  })

  it.each([['../evil'], ['scripts/a/b.sh'], ['other/x.sh'], ['scripts'], ['/etc/passwd']])(
    'путь %j в архив не попадает — одно кривое имя не роняет маршрут',
    (path) => {
      const skill = toSkill(list(), 'ru', { ...ctx, authored: authored([[path, 'x'], ['scripts/ok.sh', 'ok']]) })
      expect(skill.files.map((f) => f.path)).not.toContain(path)
      expect(skill.files.map((f) => f.path), 'вместе с кривым выброшен и законный').toContain('scripts/ok.sh')
      expect(() => tarGz(skill.files.map((f) => ({ path: `n/${f.path}`, content: f.content })).concat({ path: 'n/', content: '' }))).not.toThrow()
    },
  )

  it('однофайловый SKILL.md называет архив, если у версии есть авторские файлы', () => {
    const md = toSkillMarkdown(list(), 'ru', { ...ctx, authored: authored([['assets/t.md', 'x']]) })
    expect(md).toContain('skill.tar.gz')
    expect(md).not.toContain('](assets/')
  })

  it('ядро не ответило (null) — скилл тот же, что без авторских файлов', () => {
    expect(toSkill(list(), 'ru', { ...ctx, authored: null }).markdown).toBe(toSkill(list(), 'ru', ctx).markdown)
  })
})

/**
 * ДЛИННЫЕ ПУТИ В АРХИВЕ. Имя в заголовке ustar — до 100 байт, а путь в архиве —
 * `<имя скилла до 64>/<каталог>/<файл>`. Ядро длину имени файла не ограничивает, и
 * кириллица набирает 100 байт быстро. Раньше такой файл ронял маршрут в 500 (находка
 * ревью диффа): каталоги теперь уходят в родное поле ustar `prefix`, а файл, чьё
 * ИМЯ само длиннее 100 байт, в архив не кладётся и называется в `skipped`.
 */
describe('длинные пути авторских файлов', () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  const longSlug = 'a'.repeat(60)

  function extract(buf: Buffer): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'skill-long-'))
    writeFileSync(join(dir, 'a.tgz'), buf)
    execFileSync('tar', ['-xzf', join(dir, 'a.tgz'), '-C', dir])
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [relative(dir, join(d, f))]))
    return walk(dir).filter((p) => p !== 'a.tgz')
  }

  it('путь длиннее 100 байт распаковывается туда, куда должен', () => {
    const file = `references/${'почему-так-сделано-'.repeat(2)}.md`
    const skill = toSkill(list({ slug: longSlug }), 'ru', { ...ctx, authored: [{ path: file, content: enc('x'), executable: false }] })
    const full = `${skill.name}/${file}`
    expect(Buffer.byteLength(full), 'проба не проверяет длинный путь').toBeGreaterThan(100)
    const paths = extract(
      tarGz([{ path: `${skill.name}/` }, { path: `${skill.name}/references/` }, ...skill.files.map((f) => ({ path: `${skill.name}/${f.path}`, content: f.content }))]),
    )
    expect(paths, 'файл с длинным путём потерялся или лёг не туда').toContain(full)
  })

  it('имя файла длиннее 100 байт в архив не кладётся — и называется, а не теряется молча', () => {
    const tooLong = `scripts/${'очень-длинное-имя-'.repeat(4)}.sh`
    const skill = toSkill(list(), 'ru', { ...ctx, authored: [{ path: tooLong, content: enc('x'), executable: true }, { path: 'scripts/ok.sh', content: enc('ok'), executable: true }] })
    expect(skill.files.map((f) => f.path)).not.toContain(tooLong)
    expect(skill.files.map((f) => f.path), 'вместе с длинным выброшен и законный').toContain('scripts/ok.sh')
    expect(skill.skipped, 'пропуск молчаливый').toEqual([tooLong])
    expect(() => tarGz(skill.files.map((f) => ({ path: `n/${f.path}`, content: f.content })).concat({ path: 'n/', content: '' }))).not.toThrow()
  })

  it('без пропусков skipped пуст', () => {
    expect(toSkill(list(), 'ru', { ...ctx, authored: [{ path: 'scripts/a.sh', content: enc('a'), executable: false }] }).skipped).toEqual([])
  })
})

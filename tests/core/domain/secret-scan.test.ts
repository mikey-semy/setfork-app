// ПОИСК КЛЮЧЕЙ ДОСТУПА на записи: шаги, мета, файлы автора.
//
// Образцы ключей СОБИРАЮТСЯ здесь же генератором, а не лежат строками: литерал вида
// `ghp_` + 36 знаков в репозитории остановил бы наш собственный push (push protection
// GitHub судит тем же набором), а ещё выглядел бы для любого сканера настоящей утечкой.
// Генератор детерминирован — падение воспроизводится тем же образцом.
import { describe, expect, it } from 'vitest'
import {
  assertNoSecrets,
  findSecret,
  findSecretInContent,
  findSecretInFile,
  SECRET_RULE_IDS,
  SecretFoundError,
  secretProvider,
} from '@/core/domain/secret-scan'

/** mulberry32: маленький детерминированный ГПСЧ — чтобы образцы были «случайны», но одинаковы. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const next = rng(20260924)
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const pick = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(next() * alphabet.length)]).join('')
const alnum = (n: number) => pick(ALNUM, n)
const word = (n: number) => pick(`${ALNUM}_`, n)
const dashed = (n: number) => pick(`${ALNUM}_-`, n)
const hex = (n: number) => pick('0123456789abcdef', n)
const digits = (n: number) => pick('0123456789', n)
const upper32 = (n: number) => pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', n)
const lowerAlnum = (n: number) => pick('abcdefghijklmnopqrstuvwxyz0123456789', n)
const letters = (n: number) => pick('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', n)

/** «PRIVATE KEY» — из кусков: цельный заголовок с телом в исходнике gitleaks нашего же CI считает утечкой. */
const PEM = ['PRIVATE', 'KEY'].join(' ')

/** По образцу на КАЖДОЕ правило — в том виде, в каком ключ стоит в тексте инструкции. */
const SAMPLES: Record<string, string> = {
  'aws-access-token': `aws configure set aws_access_key_id AKIA${upper32(16)}`,
  'github-pat': `export GITHUB_TOKEN=ghp_${alnum(36)}`,
  'github-fine-grained-pat': `token: github_pat_${word(82)}`,
  'github-oauth': `gho_${alnum(36)}`,
  'github-app-token': `ghs_${alnum(36)}`,
  'github-refresh-token': `ghr_${alnum(36)}`,
  'gitlab-pat': `glpat-${dashed(20)}`,
  'openai-api-key': `OPENAI_API_KEY="sk-proj-${dashed(74)}T3BlbkFJ${dashed(74)}"`,
  'anthropic-api-key': `ANTHROPIC_API_KEY=sk-ant-api03-${dashed(93)}AA`,
  'anthropic-admin-api-key': `sk-ant-admin01-${dashed(93)}AA `,
  'openrouter-api-key': `OPENROUTER_API_KEY=sk-or-v1-${hex(64)}`,
  'slack-bot-token': `xoxb-${digits(12)}-${digits(12)}-${alnum(24)}`,
  'slack-user-token': `xoxp-${digits(12)}-${digits(12)}-${digits(12)}-${alnum(32)}`,
  'slack-app-token': `xapp-1-A${upper32(10)}-${digits(13)}-${hex(64)}`,
  'slack-webhook-url': `curl -X POST https://hooks.slack.com/services/${alnum(44)}`,
  'stripe-access-token': `STRIPE_KEY=sk_live_${alnum(24)}`,
  'gcp-api-key': `key=AIza${dashed(35)} `,
  'private-key': `-----BEGIN RSA ${PEM}-----\n${pick(`${ALNUM}+/`, 64)}\n${pick(`${ALNUM}+/`, 64)}\n-----END RSA ${PEM}-----`,
  'telegram-bot-api-token': `TELEGRAM_BOT_TOKEN=${digits(9)}:A${dashed(34)}`,
  'npm-access-token': `//registry.npmjs.org/:_authToken=npm_${lowerAlnum(36)}`,
  'pypi-upload-token': `password = pypi-AgEIcHlwaS5vcmc${dashed(60)}`,
  'huggingface-access-token': `HF_TOKEN=hf_${letters(34)}`,
  'yandex-api-key': `YANDEX_API_KEY=AQVN${dashed(36)}`,
  'yandex-access-token': `yandex_iam_token: t1.${dashed(20)}.${dashed(86)}`,
  'yandex-aws-access-token': `yandex_access_key = YC${dashed(38)}`,
  'digitalocean-pat': `doctl auth init -t dop_v1_${hex(64)}`,
  'sendgrid-api-token': `SENDGRID_API_KEY=SG.${pick(`${ALNUM}_-`, 22)}.${pick(`${ALNUM}_-`, 43)}`,
}

describe('findSecret: каждое правило ловит свой ключ', () => {
  it('образец есть у КАЖДОГО правила — новое правило без образца не пройдёт молча', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...SECRET_RULE_IDS].sort())
  })

  for (const [rule, text] of Object.entries(SAMPLES)) {
    it(rule, () => {
      expect(findSecret(text)?.rule).toBe(rule)
    })
  }

  it('ключ внутри JSON шага (так судится шаг на фасаде) — тоже ключ', () => {
    const step = { title: { ru: 'Токен' }, command: SAMPLES['openrouter-api-key'] }
    expect(findSecret(JSON.stringify(step))?.rule).toBe('openrouter-api-key')
    // Закрытый ключ в JSON — одна строка с `\n` вместо переводов строк.
    expect(findSecret(JSON.stringify({ desc: SAMPLES['private-key'] }))?.rule).toBe('private-key')
  })

  it('ключ в кавычках и с новой строки — в шаге и в list.json', () => {
    const key = SAMPLES['openrouter-api-key'].split('=')[1]
    // Кавычка после ключа в JSON становится `\\"`, перевод строки перед ним — `\\n`: по сырому
    // JSON ни хвост, ни граница слова gitleaks не срабатывали. Судятся строки, а не их запись.
    for (const command of [`curl -H "Authorization: Bearer ${key}" https://x`, `export KEY="${key}"`, `key:\t${key}\tnext`, `Ключ:\n${key}`]) {
      expect(findSecretInContent([{ command }])?.match.rule, command).toBe('openrouter-api-key')
      const listJson = JSON.stringify({ title: 't', steps: [{ title: 'a' }, { command }] }, null, 2)
      const hit = findSecretInFile('list.json', listJson)
      expect(hit?.rule, command).toBe('openrouter-api-key')
      // Строка — в том тексте, который человек откроет: шаг второй, строка его команды.
      expect(listJson.split('\n')[hit!.line - 1], command).toContain('"command"')
    }
    // Пометка истории не мешает узнать JSON.
    expect(findSecretInFile('list.json@1a2b3c4d', JSON.stringify({ d: `x\n${key}` }))?.rule).toBe('openrouter-api-key')
    // `@` в собственном имени файла — не пометка истории: JSON узнаётся по расширению.
    expect(findSecretInFile('references/cfg@v2.json', JSON.stringify({ d: `x\n${key}` }))?.rule).toBe('openrouter-api-key')
    // Неразборчивый JSON — ищется как текст, а не пропускается.
    expect(findSecretInFile('assets/bad.json', `{ broken ${key} `)?.rule).toBe('openrouter-api-key')
  })
})

describe('findSecret: честный текст проходит', () => {
  /** Всё это встречается в инструкциях постоянно; отказ на нём научил бы авторов обходить проверку. */
  const HONEST = [
    'export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // заглушка: энтропия ноль
    `export GITHUB_TOKEN=ghp_${'a'.repeat(36)}`,
    'aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE', // пример из документации AWS
    'key=AIzaSyabcdefghijklmnopqrstuvwxyz1234567 ', // учебный пример Google
    // Заглушка из документации Slack — собрана из кусков: литерал остановил бы наш push.
    `curl -X POST https://hooks.slack.com/services/${['T' + '0'.repeat(8), 'B' + '0'.repeat(8), 'X'.repeat(24)].join('/')}`,
    'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', // стоп-слово gitleaks
    'OPENROUTER_API_KEY=<ваш ключ>',
    'export OPENAI_API_KEY=sk-...',
    '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----',
    `-----BEGIN OPENSSH ${PEM}-----\n...\n-----END OPENSSH ${PEM}-----`, // форма без тела
    'ssh-keygen -t ed25519 -C "me@example.com"',
    'git checkout 96f5ab86e1c2b3a4d5e6f708192a3b4c5d6e7f80',
    'sha256sum: 3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1c',
    // Форма токена Telegram, но не присвоение: слово есть в тексте, а рядом с ключом — нет.
    // Без требования контекста это был бы отказ (правило не отсеялось бы по слову).
    `Создайте бота в Telegram через BotFather.\nОн пришлёт строку вида ${digits(9)}:A${dashed(34)}`,
  ]
  for (const text of HONEST) {
    it(text.slice(0, 60), () => {
      expect(findSecret(text)).toBeNull()
    })
  }
})

describe('findSecret: что видит автор', () => {
  it('ключ ЦЕЛИКОМ не повторяется: только начало и многоточие', () => {
    const text = SAMPLES['github-pat']
    const hit = findSecret(text)!
    const secret = text.slice(text.indexOf('ghp_'))
    expect(hit.fragment.endsWith('…')).toBe(true)
    expect(secret.startsWith(hit.fragment.slice(0, -1))).toBe(true)
    expect(hit.fragment.length).toBeLessThanOrEqual(9)
  })

  it('у правила с контекстом («TELEGRAM_BOT_TOKEN=…») начало — ключа, а не имени переменной', () => {
    expect(findSecret(SAMPLES['telegram-bot-api-token'])?.fragment).toMatch(/^[0-9]/)
  })

  it('строка — та, где ключ, а не где началось совпадение с контекстом', () => {
    // Имя переменной на строке 4, сам ключ — на строке 5: указать надо на ключ.
    const [name, key] = SAMPLES['telegram-bot-api-token'].split('=')
    const text = ['# Настройка', '', 'Шаг 1: установить', `${name}=`, key].join('\n')
    expect(findSecret(text)?.line).toBe(5)
  })

  it('провайдер называется словами', () => {
    expect(findSecret(SAMPLES['yandex-api-key'])?.provider).toBe('Yandex Cloud')
    expect(secretProvider('github-pat')).toBe('GitHub')
    expect(secretProvider('нет-такого')).toBeNull()
  })

  it('второй кандидат того же правила проверяется, если первый — заглушка', () => {
    const text = `ghp_${'a'.repeat(36)} и настоящий ${SAMPLES['github-pat']}`
    expect(findSecret(text)?.rule).toBe('github-pat')
  })
})

describe('findSecretInContent / assertNoSecrets: место находки', () => {
  const files = (path: string, text: string) => [{ path, content: new TextEncoder().encode(text) }]

  it('шаг — с единицы', () => {
    const hit = findSecretInContent([{ title: 'ok' }, { command: SAMPLES['github-pat'] }])
    expect(hit).toMatchObject({ step: 2, match: { rule: 'github-pat' } })
    expect(hit?.path).toBeUndefined()
  })

  it('мета (название, описание) — шаг 0 без пути', () => {
    expect(findSecretInContent([], undefined, { desc: { ru: SAMPLES['stripe-access-token'] } })).toMatchObject({ step: 0 })
  })

  it('файл автора — путь и строка; проверяются ВСЕ файлы, не только scripts/', () => {
    const hit = findSecretInContent([], files('references/setup.md', `# Setup\n\n${SAMPLES['openrouter-api-key']}\n`))
    expect(hit).toMatchObject({ step: 0, path: 'references/setup.md', match: { line: 3 } })
  })

  it('ключ в ИМЕНИ поля (metadata шапки скилла) — тоже ключ', () => {
    const key = SAMPLES['openrouter-api-key'].split('=')[1]
    expect(findSecretInContent([], undefined, { metadata: { [key]: 'x' } })?.match.rule).toBe('openrouter-api-key')
  })

  it('файлы не заданы (перенос из прошлой версии) — не проверяются', () => {
    expect(findSecretInContent([{ title: 'ok' }], undefined)).toBeNull()
  })

  it('страж бросает отказ с тем же местом', () => {
    try {
      assertNoSecrets([], files('scripts/deploy.sh', `#!/bin/sh\n${SAMPLES['digitalocean-pat']}`))
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SecretFoundError)
      const err = e as SecretFoundError
      expect(err.path).toBe('scripts/deploy.sh')
      expect(err.match.line).toBe(2)
      expect(err.message).toBe('secret_found:digitalocean-pat')
    }
  })
})

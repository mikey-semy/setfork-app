/**
 * Поиск ключей доступа в том, что пишут в список: «не утечёт ли это».
 *
 * Список видят другие люди, скилл ставят к себе чужие агенты, а версии хранятся вечно —
 * ключ, попавший в шаг или в `scripts/deploy.sh`, уже не забрать правкой: он лежит в
 * истории, в зеркалах и в архивах `skill.tar.gz`. Поэтому проверка стоит НА ЗАПИСИ и
 * отказывает, как push protection у GitHub, а не помечает после.
 *
 * # Откуда правила
 *
 * Шаблоны взяты из gitleaks (MIT, `config/gitleaks.toml`, коммит b58d3f1) — тот же набор,
 * которым пользуется половина CI мира. Взяты только правила с ОДНОЗНАЧНЫМ префиксом
 * провайдера (`ghp_`, `AKIA`, `sk-ant-api03-`, `-----BEGIN … PRIVATE KEY-----`): у них
 * ложное срабатывание — редкость. «Общие» правила gitleaks (`generic-api-key` — слово
 * key рядом со случайной строкой) не взяты сознательно: на тексте инструкций они ловили
 * бы примеры, хэши и идентификаторы, а отказ, который часто врёт, авторы учатся обходить.
 *
 * Отличия от оригинала названы у правил. Общее: Go-флаги внутри шаблона (`(?-i:A)`,
 * `(?i:…)`) переписаны явными классами — в JS их нет у целевой версии TS.
 *
 * Одно правило своё — OpenRouter: в gitleaks его нет, а это ключ, который люди этого
 * продукта держат чаще прочих (весь ИИ-слой ходит через него). Форма `sk-or-v1-` +
 * 64 hex сверена с живым ключом без его печати.
 */

/** Правило: шаблон, подсказки для дешёвого отсева и порог случайности. */
interface SecretRule {
  /** Код правила — id из gitleaks, по нему автор узнаёт вид ключа. */
  id: string
  /** Чей это ключ — имя собственное, в словарь не идёт: «GitHub» по-русски тоже GitHub. */
  provider: string
  /** Первая группа (если есть) — сам ключ; иначе ключ — всё совпадение. */
  re: RegExp
  /** Хоть одно из слов (в нижнем регистре) обязано быть в тексте — иначе шаблон не гоняем. */
  keywords: string[]
  /** Порог энтропии Шеннона у ключа: ниже — это не ключ, а `ghp_aaaa…` в примере. */
  entropy?: number
  /** Ключи из документации провайдера — известные примеры, а не утечки. */
  allow?: RegExp[]
}

/** Хвост после ключа у правил gitleaks: кавычка, пробел, `;`, экранированный перевод строки или конец. */
const END = String.raw`(?:[\x60'"\s;]|\\[nr]|$)`
/** Контекст «имя = значение» у правил, которым мало одной формы ключа (Telegram, Яндекс). */
const ASSIGN = String.raw`(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}`

const RULES: SecretRule[] = [
  {
    id: 'aws-access-token', provider: 'AWS',
    re: /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/,
    keywords: ['a3t', 'akia', 'asia', 'abia', 'acca'],
    entropy: 3,
    allow: [/.+EXAMPLE$/],
  },
  { id: 'github-pat', provider: 'GitHub', re: /ghp_[0-9a-zA-Z]{36}/, keywords: ['ghp_'], entropy: 3 },
  { id: 'github-fine-grained-pat', provider: 'GitHub', re: /github_pat_\w{82}/, keywords: ['github_pat_'], entropy: 3 },
  { id: 'github-oauth', provider: 'GitHub', re: /gho_[0-9a-zA-Z]{36}/, keywords: ['gho_'], entropy: 3 },
  { id: 'github-app-token', provider: 'GitHub', re: /(?:ghu|ghs)_[0-9a-zA-Z]{36}/, keywords: ['ghu_', 'ghs_'], entropy: 3 },
  { id: 'github-refresh-token', provider: 'GitHub', re: /ghr_[0-9a-zA-Z]{36}/, keywords: ['ghr_'], entropy: 3 },
  { id: 'gitlab-pat', provider: 'GitLab', re: /glpat-[\w-]{20}/, keywords: ['glpat-'], entropy: 3 },
  {
    id: 'openai-api-key', provider: 'OpenAI',
    re: new RegExp(
      String.raw`\b(sk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})\b|sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})` +
        END,
    ),
    keywords: ['t3blbkfj'],
    entropy: 3,
  },
  { id: 'anthropic-api-key', provider: 'Anthropic', re: new RegExp(String.raw`\b(sk-ant-api03-[a-zA-Z0-9_\-]{93}AA)` + END), keywords: ['sk-ant-api03'] },
  { id: 'anthropic-admin-api-key', provider: 'Anthropic', re: new RegExp(String.raw`\b(sk-ant-admin01-[a-zA-Z0-9_\-]{93}AA)` + END), keywords: ['sk-ant-admin01'] },
  // Своё правило, не из gitleaks (см. шапку).
  { id: 'openrouter-api-key', provider: 'OpenRouter', re: new RegExp(String.raw`\b(sk-or-v1-[0-9a-f]{64})` + END), keywords: ['sk-or-v1-'], entropy: 3 },
  { id: 'slack-bot-token', provider: 'Slack', re: /xoxb-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/, keywords: ['xoxb'], entropy: 3 },
  { id: 'slack-user-token', provider: 'Slack', re: /xox[pe](?:-[0-9]{10,13}){3}-[a-zA-Z0-9-]{28,34}/, keywords: ['xoxp-', 'xoxe-'], entropy: 2 },
  { id: 'slack-app-token', provider: 'Slack', re: /xapp-\d-[A-Z0-9]+-\d+-[a-z0-9]+/i, keywords: ['xapp'], entropy: 2 },
  {
    id: 'slack-webhook-url', provider: 'Slack',
    re: /(?:https?:\/\/)?hooks.slack.com\/(?:services|workflows|triggers)\/[A-Za-z0-9+/]{43,56}/,
    keywords: ['hooks.slack.com'],
    // Своё исключение, не из gitleaks: заглушка из документации Slack (нули и иксы).
    // Энтропии у правила нет, и учебник по вебхукам иначе не публиковался бы вовсе.
    // GitHub её отвергает (проверено пушем) — здесь отклонение в сторону «лучше»: такой
    // адрес не ведёт никуда. Публичный тестовый ключ Stripe из их документации, напротив,
    // отвергаем, как GitHub: он настоящий, просто общий.
    allow: [/\/T0+\/B0+\/X+$/],
  },
  {
    id: 'stripe-access-token', provider: 'Stripe',
    re: new RegExp(String.raw`\b((?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99})` + END),
    keywords: ['sk_test', 'sk_live', 'sk_prod', 'rk_test', 'rk_live', 'rk_prod'],
    entropy: 2,
  },
  {
    id: 'gcp-api-key', provider: 'Google Cloud',
    re: new RegExp(String.raw`\b(AIza[\w-]{35})` + END),
    keywords: ['aiza'],
    entropy: 4,
    // Из шестнадцати примеров gitleaks взят тот, что встречается в учебниках: остальные —
    // публичные ключи конкретных SDK, и в тексте списка им взяться неоткуда.
    allow: [/^AIzaSyabcdefghijklmnopqrstuvwxyz1234567$/],
  },
  {
    id: 'private-key', provider: 'SSH/TLS',
    // `[\s\S-]` у gitleaks — это `[\s\S]`: дефис в нём и так есть.
    re: /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]{64,}?KEY(?: BLOCK)?-----/i,
    keywords: ['-----begin'],
  },
  {
    id: 'telegram-bot-api-token', provider: 'Telegram',
    // У gitleaks весь шаблон `(?i)`, кроме буквы `A` в начале ключа (`(?-i:A)`): здесь
    // наоборот — без флага, а без регистра написаны слово и хвост ключа.
    re: new RegExp(String.raw`(?:[Tt][Ee][Ll][Ee][Gg][Rr])` + ASSIGN + String.raw`([0-9]{5,16}:A[A-Za-z0-9_\-]{34})` + END),
    keywords: ['telegr'],
  },
  { id: 'npm-access-token', provider: 'npm', re: new RegExp(String.raw`\b(npm_[a-z0-9]{36})` + END, 'i'), keywords: ['npm_'], entropy: 2 },
  { id: 'pypi-upload-token', provider: 'PyPI', re: /pypi-AgEIcHlwaS5vcmc[\w-]{50,1000}/, keywords: ['pypi-ageichlwas5vcmc'], entropy: 3 },
  // `hf_(?i:[a-z]{34})` у gitleaks — буквы любого регистра.
  { id: 'huggingface-access-token', provider: 'Hugging Face', re: new RegExp(String.raw`\b(hf_[a-zA-Z]{34})` + END), keywords: ['hf_'], entropy: 2 },
  {
    id: 'yandex-api-key', provider: 'Yandex Cloud',
    re: new RegExp(String.raw`(?:yandex)` + ASSIGN + String.raw`(AQVN[A-Za-z0-9_\-]{35,38})` + END, 'i'),
    keywords: ['yandex'],
  },
  {
    id: 'yandex-access-token', provider: 'Yandex Cloud',
    re: new RegExp(String.raw`(?:yandex)` + ASSIGN + String.raw`(t1\.[A-Z0-9a-z_-]+[=]{0,2}\.[A-Z0-9a-z_-]{86}[=]{0,2})` + END, 'i'),
    keywords: ['yandex'],
  },
  {
    id: 'yandex-aws-access-token', provider: 'Yandex Cloud',
    re: new RegExp(String.raw`(?:yandex)` + ASSIGN + String.raw`(YC[a-zA-Z0-9_\-]{38})` + END, 'i'),
    keywords: ['yandex'],
  },
  { id: 'digitalocean-pat', provider: 'DigitalOcean', re: new RegExp(String.raw`\b(dop_v1_[a-f0-9]{64})` + END), keywords: ['dop_v1_'], entropy: 3 },
  // `SG\.(?i)[a-z0-9…]` у gitleaks — хвост любого регистра.
  { id: 'sendgrid-api-token', provider: 'SendGrid', re: new RegExp(String.raw`\b(SG\.[a-zA-Z0-9=_\-.]{66})` + END), keywords: ['sg.'], entropy: 2 },
]

/**
 * Глобальные стоп-слова gitleaks (`[allowlist] stopwords`): ключ, содержащий их, — пример.
 * Остальной глобальный allowlist gitleaks — шаблоны подстановок (`${VAR}`, `{{ … }}`,
 * `%s`, пути `/usr/…`) — к ключам с префиксом провайдера неприменим и не перенесён.
 */
const STOPWORDS = ['014df517-39d1-4453-b7b3-9930c563627c', 'abcdefghijklmnopqrstuvwxyz']

/** Коды всех правил — для тестов. */
export const SECRET_RULE_IDS: readonly string[] = RULES.map((r) => r.id)

/** Чей ключ по коду правила — странице, получившей код в адресе. Неизвестный код → `null`. */
export const secretProvider = (rule: string): string | null => RULES.find((r) => r.id === rule)?.provider ?? null

/** Энтропия Шеннона в битах на символ — как `shannonEntropy` у gitleaks. */
function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

export interface SecretMatch {
  /** Код правила (id gitleaks) — вид ключа. */
  rule: string
  /** Чей ключ — для текста отказа. */
  provider: string
  /** Строка текста (с единицы), где начинается ключ. */
  line: number
  /** Начало ключа с многоточием. Ключ ЦЕЛИКОМ не повторяется нигде — ни в ответе, ни в логе. */
  fragment: string
}

/** Начало ключа, по которому его узнать, — и ни символом больше. */
function masked(secret: string): string {
  return `${secret.slice(0, Math.min(8, Math.floor(secret.length / 3)))}…`
}

/** Находка вместе с самим ключом — только внутри модуля: наружу ключ целиком не выходит. */
function scan(text: string): { rule: SecretRule; secret: string; at: number } | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const rule of RULES) {
    if (!rule.keywords.some((k) => lower.includes(k))) continue
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`)
    for (const m of text.matchAll(re)) {
      const secret = m[1] ?? m[0]
      if (rule.entropy !== undefined && entropy(secret) < rule.entropy) continue
      if (rule.allow?.some((a) => a.test(secret))) continue
      if (STOPWORDS.some((w) => secret.toLowerCase().includes(w))) continue
      return { rule, secret, at: (m.index ?? 0) + m[0].indexOf(secret) }
    }
  }
  return null
}

const matchOf = (rule: SecretRule, secret: string, line: number): SecretMatch => ({
  rule: rule.id,
  provider: rule.provider,
  line,
  fragment: masked(secret),
})

/** Первый ключ в тексте или `null`. Порядок правил — порядок проверки. */
export function findSecret(text: string): SecretMatch | null {
  const hit = scan(text)
  return hit ? matchOf(hit.rule, hit.secret, text.slice(0, hit.at).split('\n').length) : null
}

/**
 * Все строки объекта — ТЕКСТОМ, а не сериализованным JSON. В JSON перевод строки и таб
 * записаны как `\n` и `\t`: ключ с начала строки оказывается сразу за буквой, граница
 * слова `\b` в начале шаблона не срабатывает, и ключ в многострочном описании шага
 * не находился (поймано тестом на `key:\t<ключ>`).
 */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('\n')
  if (v && typeof v === 'object') return Object.values(v).map(textOf).filter(Boolean).join('\n')
  return ''
}

/**
 * Ключ в тексте JSON-файла (`list.json` на пуше): ищется по строкам документа, как на
 * фасаде, а строка для человека — по сырому тексту, который он откроет в редакторе.
 * Не разобрался — ищем по тексту как есть.
 */
export function findSecretInJsonText(raw: string): SecretMatch | null {
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return findSecret(raw)
  }
  const hit = scan(textOf(doc))
  if (!hit) return null
  const at = raw.indexOf(JSON.stringify(hit.secret).slice(1, -1))
  return matchOf(hit.rule, hit.secret, at < 0 ? 1 : raw.slice(0, at).split('\n').length)
}

/**
 * Ключ в файле: JSON — по строкам документа (см. `findSecretInJsonText`), прочее — текстом.
 * Путь может нести пометку истории `путь@коммит` — расширение смотрится до неё.
 */
export function findSecretInFile(path: string, text: string): SecretMatch | null {
  // Пометку снимаем ТОЛЬКО в её форме (`@` + 8 hex): `@` законен в имени файла (`cfg@v2.json`).
  return path.replace(/@[0-9a-f]{8}$/, '').toLowerCase().endsWith('.json') ? findSecretInJsonText(text) : findSecret(text)
}

/**
 * Отказ записи: в содержимом ключ доступа. Место — шаг (с единицы) или файл автора;
 * у меты списка (название, описание) шаг 0 и пути нет.
 */
export class SecretFoundError extends Error {
  constructor(
    readonly match: SecretMatch,
    readonly stepIndex: number,
    readonly path?: string,
  ) {
    super(`secret_found:${match.rule}`)
    this.name = 'SecretFoundError'
  }
}

/** Находка с МЕСТОМ: шаг (с единицы) или файл автора; у меты списка — ни того, ни другого. */
export interface SecretHit {
  match: SecretMatch
  /** Шаг с единицы; 0 — не шаг (мета или файл). */
  step: number
  path?: string
}

/**
 * Первый ключ в содержимом записи: мета, шаги, файлы автора — в этом порядке.
 *
 * Шаг проверяется ЦЕЛИКОМ (все его строки), а не по списку полей: ключ одинаково утекает
 * из команды, описания, ссылки и подпункта, а перечень полей рос бы вместе с блоками и
 * однажды отстал. Файлы — все, не только `scripts/`: `references/setup.md` с токеном
 * утекает так же. `authored === undefined` — файлы переносятся из прошлой версии, где их
 * уже проверили.
 */
export function findSecretInContent(
  steps: readonly object[],
  authored?: readonly { path: string; content: Uint8Array }[],
  meta?: object,
): SecretHit | null {
  const inMeta = meta ? findSecret(textOf(meta)) : null
  if (inMeta) return { match: inMeta, step: 0 }
  for (const [i, s] of steps.entries()) {
    const match = findSecret(textOf(s))
    if (match) return { match, step: i + 1 }
  }
  for (const f of authored ?? []) {
    const match = findSecretInFile(f.path, new TextDecoder().decode(f.content))
    if (match) return { match, step: 0, path: f.path }
  }
  return null
}

/** Страж записи на фасаде: первая находка останавливает запись целиком. */
export function assertNoSecrets(
  steps: readonly object[],
  authored: readonly { path: string; content: Uint8Array }[] | undefined,
  meta?: object,
): void {
  const hit = findSecretInContent(steps, authored, meta)
  if (hit) throw new SecretFoundError(hit.match, hit.step, hit.path)
}

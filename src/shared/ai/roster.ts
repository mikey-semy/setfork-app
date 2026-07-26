import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { councilExperts, db } from '@/shared/db'
import { avatarSrc } from '@/shared/media'
import { ORG_SEED } from './roster-org'
import type { Lang } from '@/shared/i18n'

/**
 * Ростер совета: кто такие эксперты и как они себя ведут. Живёт в БД (council_experts), чтобы
 * владелец правил его в админке, а не правкой кода и деплоем.
 *
 * SEED — исходный состав. Он не «дефолт на всякий случай», а источник первого наполнения: пока
 * таблица пуста, совет работает ровно как раньше, и включение менеджера ничего не ломает.
 *
 * id смысловой ('chef') и служит сразу тремя вещами: ключ строки, имя встроенной аватарки
 * (public/gnomes/<id>.webp) и значение who в беседе. Поэтому переименование id = потеря аватарки и
 * связи с историей; в UI меняют name, а не id.
 */

export type OrgRole = 'partner' | 'chief' | 'manager' | 'expert' | 'backoffice'

/** Кого зовёт совет: черновики списков пишут эксперты и начальники гильдий. */
export const COUNCIL_ROLES: readonly OrgRole[] = ['expert', 'chief']

export interface Expert {
  id: string
  nameEn: string
  nameRu: string
  /** Профессия отдельно от имени — уезжает в профиль как должность. Пусто → имя. */
  professionEn: string
  professionRu: string
  /** Аккаунт уровня пользователя (ADR-0004: account_type='agent'). null = не заведён. */
  userId: string | null
  /** Карьера: active → dormant → archived. Архив обратим (персона и опыт сохранены). */
  lifecycle: 'active' | 'dormant' | 'archived'
  /** Место в компании: партнёр / начальник гильдии / менеджер / эксперт / бэк-офис. */
  orgRole: OrgRole
  /** Тир мастерства по профессии (джун/мидл/сеньор, commis→шеф). Пусто = плоская. */
  tier: string
  /** «Чего не хватает» — сигнал в фиче-бэклог владельца. */
  dreams: string
  persona: string
  /** Гильдия (HQ §7) — «носитель цеха»: имя для людей, кодекс для промптов. */
  guildEn: string
  guildRu: string
  /** Кодекс гильдии — компактный свод стандартов качества (маркированные строки). */
  code: string
  /** Линза запроса (HQ §5): аспекты, которыми гном смотрит на любой запрос к базе. */
  lens: string
  /** Память (HQ §3 этап 2): выжимка ремесла из лучших списков доменов — пишет рудник. */
  memory: string
  domains: string[]
  /** Принудительная модель; пусто → из пула совета по кругу. */
  model: string
  /** Картинка: id встроенной или ключ S3. Пусто → берём id. */
  avatar: string
  avatarUploaded: boolean
  online: boolean
}

/**
 * Исходный состав — им наполняем таблицу при первом обращении.
 *
 * Персоны опираются на ПРИЗНАННЫЕ профстандарты, а не на «будь хорошим экспертом»: у модели и так
 * есть общее представление о профессии, ценность даёт конкретный каркас, по которому работают живые
 * специалисты. Источник каждой указан — чтобы правку можно было проверить, а не спорить о вкусе.
 */
/** Исходный состав задаётся без профессии/аккаунта — они выводятся ниже. */
type SeedExpert = Omit<Expert, 'professionEn' | 'professionRu' | 'userId' | 'lifecycle' | 'tier' | 'dreams' | 'orgRole'>

const SEED_BASE: SeedExpert[] = [
  {
    id: 'devops',
    nameEn: 'Devops',
    nameRu: 'Девопсер',
    guildEn: 'Reliability Guild',
    guildRu: 'Гильдия надёжности',
    code: `- Every risky step names its rollback
- Success is proven by a health-check, not by hope
- Repetitive manual work becomes a scripted step
- Reliability is a number (SLO), not a feeling`,
    lens: 'deploy rollback health-check automation reliability',
    memory: '',
    domains: ['deploy', 'devops', 'ci', 'servers', 'infra', 'docker', 'kubernetes'],
    // Google SRE Book (SLO/error budget, blameless postmortem, toil) + DORA Four Keys.
    persona:
      'a pragmatic DevOps/SRE expert. Reliability is a number, not a feeling: name the SLO and what breaks the error budget. Automate toil — repetitive manual work is a step to script, not to heroically repeat. Every risky step needs its rollback and a health-check that proves success. Judge changes by DORA four keys: deployment frequency, lead time, change failure rate, time to restore. Failures get blameless analysis of contributing causes, never a culprit.',
    model: '',
    avatar: 'devops',
    avatarUploaded: false,
    online: false,
  },
  {
    id: 'coder',
    nameEn: 'Coder',
    nameRu: 'Кодер',
    guildEn: "Coders' Guild",
    guildRu: 'Гильдия кодеров',
    code: `- Steps are small, single-purpose and reviewable
- Commands are runnable exactly as written
- Edge cases and failure modes are named, not implied
- Correctness beats cleverness`,
    lens: 'code commands edge cases tests review',
    memory: '',
    domains: ['programming', 'software', 'coding', 'api', 'library', 'framework'],
    // SOLID (R. C. Martin) + Test Pyramid (Fowler) + Google Engineering Practices + SWEBOK v4.
    persona:
      'a meticulous software engineer. Keep together what changes for one reason and depend toward abstractions (SOLID). Test behaviour, not implementation: many fast unit tests, fewer integration, a couple of e2e (test pyramid). Name the edge cases and the failure mode, not just the happy path. Steps must be small, single-purpose and reviewable; commands runnable as written. Correctness beats cleverness.',
    model: '',
    avatar: 'coder',
    avatarUploaded: false,
    online: false,
  },
  {
    id: 'chef',
    nameEn: 'Chef',
    nameRu: 'Повар',
    guildEn: "Chefs' Guild",
    guildRu: 'Гильдия поваров',
    code: `- Exact amounts, timings and temperatures — never "to taste" where a number exists
- Mise en place before heat
- Food-safety critical points are called out (danger zone 5–57 °C)
- Kitchen order: what waits, what runs in parallel, what must not`,
    lens: 'ingredients technique temperature timing food safety',
    memory: '',
    domains: ['cooking', 'food', 'recipe', 'kitchen', 'baking'],
    // Mise en place (CIA) + HACCP 7 principles (Codex CXC 1-1969) + FDA Food Code danger zone.
    persona:
      'a professional chef. Mise en place is law: everything measured and prepped before heat goes on. Give exact amounts, timings and temperatures — never "to taste" where a number exists. Respect food safety: the 5–57 °C danger zone, hot held ≥57 °C, cold ≤5 °C, and cooling 57→21 °C within 2 h; call out the critical control points where a mistake makes food unsafe. Order the work like a kitchen brigade: what waits, what runs in parallel, what must not.',
    model: '',
    avatar: 'chef',
    avatarUploaded: false,
    online: false,
  },
  {
    id: 'traveler',
    nameEn: 'Wanderer',
    nameRu: 'Странник',
    guildEn: "Wanderers' Guild",
    guildRu: 'Гильдия странников',
    code: `- Sequence by lead time: weeks out → week out → departure day
- Documents are verified against the official source for the traveller's date and passport
- Every likely failure has a fallback
- Budget and time cost sit next to each step`,
    lens: 'documents visas route timing budget fallback',
    memory: '',
    domains: ['travel', 'trip', 'city', 'tourism', 'itinerary'],
    // ISO 31030 (travel risk) + IATA Timatic (docs volatility) + CDC Yellow Book / WHO (health prep).
    persona:
      'a seasoned travel planner. Sequence by lead time: what to do 4–6 weeks out (visas, vaccines, malaria prophylaxis), a week out, and on departure day. Entry rules and documents change constantly — always tell the traveller to verify against the official source for their date and passport, never state them as settled fact. Assess route risk honestly (health, transport, area, season) and give the fallback for the likely failure. Budget and time cost belong next to each step.',
    model: '',
    avatar: 'traveler',
    avatarUploaded: false,
    online: false,
  },
  {
    id: 'coach',
    nameEn: 'Coach',
    nameRu: 'Тренер',
    guildEn: "Coaches' Guild",
    guildRu: 'Гильдия тренеров',
    code: `- Screening before load; red-flag symptoms → doctor first
- Every prescription is explicit: frequency, intensity, time, type, volume, progression
- Progress raises ONE parameter at a time
- Injury-causing form errors are named`,
    lens: 'training load progression form safety',
    memory: '',
    domains: ['fitness', 'health', 'workout', 'sport', 'nutrition'],
    // ACSM GETP (FITT-VP, preparticipation screening, progressive overload) + WHO 2020 activity guidelines.
    persona:
      'a certified fitness coach. Screening comes before load: current activity, known conditions, red-flag symptoms — and a doctor first when they appear. Prescribe with FITT-VP: frequency, intensity, time, type, volume, progression — every parameter explicit. Progress by overload above the habitual stimulus, raising ONE parameter at a time. Anchor to WHO baseline: 150–300 min moderate (or 75–150 vigorous) per week plus strength ≥2×; any activity beats none. Name the form errors that cause injury.',
    model: '',
    avatar: 'coach',
    avatarUploaded: false,
    online: false,
  },
  {
    id: 'scholar',
    nameEn: 'Scholar',
    nameRu: 'Книжник',
    guildEn: "Scholars' Guild",
    guildRu: 'Гильдия книжников',
    code: `- Sources are weighed against THIS question, not the brand
- The search path is reproducible: what was searched, included, rejected and why
- Disagreements are cited, not smoothed over
- Comprehension checks are built in`,
    lens: 'sources study methods verification practice',
    memory: '',
    domains: ['study', 'learning', 'research', 'course', 'exam'],
    // ACRL Framework for Information Literacy + PRISMA 2020 (reproducible search).
    persona:
      'a thoughtful scholar. Authority is constructed and contextual: weigh a source against THIS question, not by brand. Research is inquiry — the question sharpens as you search, so one query is not a search; vary wording and channels. Scholarship is a conversation: say who disagrees with whom and cite. Make the path reproducible: what was searched, what was included, what was rejected and why. Build in comprehension checks — a step the learner can use to prove they got it.',
    model: '',
    avatar: 'scholar',
    avatarUploaded: false,
    online: false,
  },
  {
    id: 'hoarder',
    nameEn: 'Hoarder',
    nameRu: 'Барахольщик',
    guildEn: "Scavengers' Guild",
    guildRu: 'Гильдия барахольщиков',
    code: `- Every find passes CRAAP: currency, relevance, authority, accuracy, purpose
- Never just a name: what it is FOR, what it costs, and its catch
- Primary and official sources are preferred
- Staleness is admitted, never hidden`,
    lens: 'tools resources links prices alternatives',
    memory: '',
    domains: ['*'],
    // Belbin Resource Investigator (+ его allowable weakness) + CRAAP test.
    persona:
      'a resource investigator (Belbin): the team’s scout, working outward for tools, links and options others miss. Run every find through CRAAP before offering it: currency, relevance, authority, accuracy, purpose. Your known weakness is enthusiasm without follow-through — so never just name a resource: say what it is FOR, what it costs, and its catch. Prefer primary and official sources; if a link may be stale, say so rather than pretend.',
    model: '',
    avatar: 'hoarder',
    avatarUploaded: false,
    online: true,
  },
  {
    id: 'generalist',
    nameEn: 'Generalist',
    nameRu: 'Универсал',
    guildEn: "Generalists' Guild",
    guildRu: 'Гильдия универсалов',
    code: `- Classify the task before picking the method
- "Look back" is a real step that verifies the result
- Checklist shape: short blocks, clear pause points
- Each step marked read-do or do-confirm`,
    lens: 'method structure checklist verification',
    memory: '',
    domains: ['*'],
    // Cynefin (Snowden & Boone, HBR) + Pólya «How to Solve It» + Checklist Manifesto / WHO checklist.
    persona:
      'a well-rounded generalist. First classify the task, then pick the method (Cynefin): clear → best practice; complicated → analysis; complex → a probe step and observe; chaotic → act first, stabilise, then think. Work Pólya’s way: understand → plan → do → LOOK BACK — the last step is the one everyone skips, so make it a real step that verifies the result. Shape the list like a working checklist: short blocks, clear pause points, and mark whether a step is read-do (do as you read) or do-confirm (do it, then verify).',
    model: '',
    avatar: 'generalist',
    avatarUploaded: false,
    online: false,
  },
]

/**
 * Исходный состав как Expert. Профессия выводится из имени НЕ для галочки: у этого
 * состава имя И БЫЛО профессией ('Chef'/'Повар'), так что это точная миграция смысла.
 * Дальше владелец даёт специалистам собственные имена в админке, а профессия остаётся
 * здесь и показывается в профиле как должность.
 */
/**
 * «Кодер» и «Девопсер» — ЗОНТИКИ над специализациями (бэкендер/тестировщик,
 * безопасник/инженер БД), поэтому они начальники гильдий: созывают своих внутри
 * специальности. Остальная восьмёрка — профильные эксперты.
 */
const CHIEFS = new Set(['coder', 'devops'])

const withDefaults = (e: SeedExpert, orgRole: OrgRole): Expert => ({
  ...e,
  orgRole,
  professionEn: e.nameEn,
  professionRu: e.nameRu,
  userId: null,
  lifecycle: 'active',
  tier: '', // лестницу мастерства заводим по надобности; у части профессий её нет
  dreams: '',
})

export const SEED: Expert[] = [
  ...SEED_BASE.map((e) => withDefaults(e, CHIEFS.has(e.id) ? 'chief' : 'expert')),
  ...ORG_SEED.map(({ orgRole, ...e }) => withDefaults(e, orgRole)),
]

const row2expert = (r: typeof councilExperts.$inferSelect): Expert => ({
  id: r.id,
  nameEn: r.nameEn,
  nameRu: r.nameRu,
  professionEn: r.professionEn,
  professionRu: r.professionRu,
  userId: r.userId,
  lifecycle: r.lifecycle,
  orgRole: r.orgRole,
  tier: r.tier,
  dreams: r.dreams,
  persona: r.persona,
  guildEn: r.guildEn,
  guildRu: r.guildRu,
  code: r.code,
  lens: r.lens,
  memory: r.memory,
  domains: r.domains,
  model: r.model,
  avatar: r.avatar || r.id,
  avatarUploaded: r.avatarUploaded,
  online: r.online,
})

/** Наполнить пустую таблицу исходным составом. Идемпотентно: занятые id не трогаем. */
export async function seedRoster(): Promise<void> {
  await db
    .insert(councilExperts)
    .values(SEED.map((e, i) => ({ ...e, avatar: e.id, sort: i })))
    .onConflictDoNothing()
}

/**
 * Догнать гильдии/линзы у СУЩЕСТВУЮЩИХ строк (HQ §7): таблица на проде уже
 * наполнена, onConflictDoNothing новые поля не проставит. ОДНОРАЗОВОСТЬ (фикс
 * по ревью волны): если хоть у одного SEED-гнома поле уже непустое — бэкфилл
 * этого поля был (или админ заполнил сам) и больше НЕ выполняется. Иначе
 * очищенный админом кодекс молча воскресал бы на каждом чтении ростера.
 * Вызывается только из getRosterAll (админка) — не из горячего пути совета.
 */
async function backfillGuilds(rows: (typeof councilExperts.$inferSelect)[]): Promise<boolean> {
  const seedRows = rows.filter((r) => SEED.some((s) => s.id === r.id))
  let changed = false
  if (seedRows.length && seedRows.every((r) => !r.code)) {
    for (const s of SEED.filter((s) => seedRows.some((r) => r.id === s.id)))
      await db
        .update(councilExperts)
        .set({ guildEn: s.guildEn, guildRu: s.guildRu, code: s.code, updatedAt: new Date() })
        .where(and(eq(councilExperts.id, s.id), eq(councilExperts.code, '')))
    changed = true
  }
  // Линза (появилась позже гильдий) — отдельный одноразовый проход по тому же правилу.
  if (seedRows.length && seedRows.every((r) => !r.lens)) {
    for (const s of SEED.filter((s) => seedRows.some((r) => r.id === s.id)))
      await db
        .update(councilExperts)
        .set({ lens: s.lens, updatedAt: new Date() })
        .where(and(eq(councilExperts.id, s.id), eq(councilExperts.lens, '')))
    changed = true
  }
  return changed
}

/**
 * Действующий ростер (только включённые, в заданном порядке). Пустая таблица → сеем и читаем снова.
 * Любая ошибка БД → SEED: совет обязан работать, даже если менеджер сломан.
 */
export async function getRoster(): Promise<Expert[]> {
  try {
    // Пул созыва = рубильник админа включён, карьера активна И роль пишущая. Спящих и
    // архивных не созываем (архив обратим). Бэк-офис (бухгалтер, летописец, HR) и
    // партнёры в пул НЕ входят: их работа — не черновики списков.
    const read = () =>
      db
        .select()
        .from(councilExperts)
        .where(
          and(
            eq(councilExperts.enabled, true),
            eq(councilExperts.lifecycle, 'active'),
            inArray(councilExperts.orgRole, [...COUNCIL_ROLES]),
          ),
        )
        .orderBy(asc(councilExperts.sort))
    let rows = await read()
    if (rows.length === 0) {
      await seedRoster()
      rows = await read()
    }
    // Бэкфилл гильдий здесь НЕ зовём (фикс по ревью): getRoster — горячий путь
    // каждого совета, писать в БД на чтении нельзя; бэкфилл живёт в getRosterAll.
    return rows.length ? rows.map(row2expert) : SEED
  } catch (e) {
    console.warn('[roster] fallback to SEED', e instanceof Error ? e.message : e)
    return SEED
  }
}

/**
 * id → URL картинки, ТОЛЬКО там, где она отличается от встроенной по умолчанию.
 * Нужна чату: он строит путь из who (`/gnomes/<who>.webp`), и без этой карты смена аватарки в
 * админке была бы видна только в админке. Пустая запись = картинка по умолчанию, путь строит UI.
 */
export async function rosterAvatars(): Promise<Record<string, string>> {
  try {
    const rows = await db.select().from(councilExperts)
    const out: Record<string, string> = {}
    for (const r of rows) {
      if (r.avatarUploaded && r.avatar) {
        const url = await avatarSrc(r.avatar, 128)
        if (url) out[r.id] = url
      } else if (r.avatar && r.avatar !== r.id) {
        out[r.id] = `/gnomes/${r.avatar}.webp` // выбрали другого встроенного персонажа
      }
    }
    return out
  } catch {
    return {} // без карты UI просто нарисует встроенные — беседа важнее аватарок
  }
}

/**
 * id → отображаемое имя гнома на языке зрителя. Нужна там, где есть только id
 * (родословная кандидата хранит id экспертов) — чтобы показать «Универсал», а не
 * «generalist». Ошибка/пусто → UI капитализирует id как фолбэк.
 */
export async function rosterNames(lang: Lang): Promise<Record<string, string>> {
  try {
    const rows = await db.select().from(councilExperts)
    const out: Record<string, string> = {}
    for (const r of rows) {
      const e = row2expert(r)
      out[r.id] = lang === 'ru' ? e.nameRu : e.nameEn
    }
    return out
  } catch {
    return {}
  }
}

/** Весь ростер для админки — включая выключенных. */
export async function getRosterAll(): Promise<(Expert & { enabled: boolean; sort: number })[]> {
  await seedRoster()
  let rows = await db.select().from(councilExperts).orderBy(asc(councilExperts.sort))
  if (await backfillGuilds(rows)) rows = await db.select().from(councilExperts).orderBy(asc(councilExperts.sort))
  return rows.map((r) => ({ ...row2expert(r), enabled: r.enabled, sort: r.sort }))
}

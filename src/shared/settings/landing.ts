import 'server-only'
import { getSettings, saveSettings } from './kv'

// Редактируемый копирайт маркетинг-лендинга (проект setfork-about). Хранится ОДНИМ
// JSON-ключом в app_settings; лендинг тянет его через /api/landing (ISR). Здесь —
// только поля, которые реально правят (hero/CTA/футер/числа-статы); остальной текст
// живёт дефолтами в самом лендинге (setfork-about/src/copy.ts). Дефолты ниже
// совпадают с ними, чтобы «из коробки» ничего не менялось до первой правки.

const KEY = 'landing.content'

export interface LandingStat {
  num: string
  label: string
}
export interface LandingCopy {
  eyebrow: string
  heroTitle: string
  heroTitleAccent: string
  heroSub: string
  stats: LandingStat[] // 4 плитки доверия
  ctaTitle: string
  ctaSub: string
  ctaPrimary: string
  ctaSecondary: string
  footerBlurb: string
  footerNote: string
}
export interface LandingContent {
  en: LandingCopy
  ru: LandingCopy
}

export const LANDING_DEFAULTS: LandingContent = {
  en: {
    eyebrow: 'GitHub for lists',
    heroTitle: 'Lists that get',
    heroTitleAccent: 'better together.',
    heroSub: 'Living, runnable lists — checklists, recipes, procedures, courses. A community keeps them accurate and up to date, and AI helps fill the gaps.',
    stats: [
      { num: '12k+', label: 'public lists' },
      { num: '48k+', label: 'contributions' },
      { num: '2.3k+', label: 'makers' },
      { num: 'MCP', label: 'agent-ready' },
    ],
    ctaTitle: 'Start your first list today',
    ctaSub: 'Free to browse, improve and run. Bring your agent along over MCP.',
    ctaPrimary: 'Get started free',
    ctaSecondary: 'Connect an agent',
    footerBlurb: 'Living, runnable lists — improved by the community and AI.',
    footerNote: 'Better together.',
  },
  ru: {
    eyebrow: 'GitHub для списков',
    heroTitle: 'Списки, которые улучшаем',
    heroTitleAccent: 'вместе.',
    heroSub: 'Живые, исполняемые списки — чек-листы, рецепты, процедуры, курсы. Сообщество держит их актуальными, а ИИ помогает закрыть пробелы.',
    stats: [
      { num: '12k+', label: 'публичных списков' },
      { num: '48k+', label: 'улучшений' },
      { num: '2.3k+', label: 'авторов' },
      { num: 'MCP', label: 'готов для агентов' },
    ],
    ctaTitle: 'Создай свой первый список сегодня',
    ctaSub: 'Смотреть, улучшать и запускать — бесплатно. Подключи своего агента по MCP.',
    ctaPrimary: 'Начать бесплатно',
    ctaSecondary: 'Подключить агента',
    footerBlurb: 'Живые, исполняемые списки — улучшаются сообществом и ИИ.',
    footerNote: 'Вместе — лучше.',
  },
}

function mergeCopy(base: LandingCopy, over?: Partial<LandingCopy>): LandingCopy {
  if (!over) return base
  return {
    ...base,
    ...over,
    stats: Array.isArray(over.stats) && over.stats.length ? over.stats.slice(0, 4) : base.stats,
  }
}

/** Контент лендинга: сохранённые правки поверх дефолтов (безопасно к битому JSON). */
export async function getLandingContent(): Promise<LandingContent> {
  const raw = (await getSettings([KEY]))[KEY]
  if (!raw) return LANDING_DEFAULTS
  try {
    const saved = JSON.parse(raw) as Partial<LandingContent>
    return {
      en: mergeCopy(LANDING_DEFAULTS.en, saved.en),
      ru: mergeCopy(LANDING_DEFAULTS.ru, saved.ru),
    }
  } catch {
    return LANDING_DEFAULTS
  }
}

/** Сохранить контент лендинга (админ). Пустой объект → сброс к дефолтам. */
export async function saveLandingContent(content: LandingContent): Promise<void> {
  const isDefault = JSON.stringify(content) === JSON.stringify(LANDING_DEFAULTS)
  await saveSettings({ [KEY]: isDefault ? '' : JSON.stringify(content) })
}

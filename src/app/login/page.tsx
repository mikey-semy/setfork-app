import Link from 'next/link'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { redirect } from 'next/navigation'
import { LoginForm } from '@/features/auth/AuthForms'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  if (session) redirect('/')
  const hasGithub = !!process.env.GITHUB_CLIENT_ID
  // На проде задаётся DEMO_URL=https://demo.setfork.com → «demo» ведёт в изолированную
  // песочницу (там свой богатый контент), а не логинит пустого юзера в прод-базе. На
  // самом demo-сайте эту переменную НЕ задаём — там обычный demo-вход. (Серверный
  // компонент читает рантайм-env, поэтому НЕ NEXT_PUBLIC — меняется без пересборки.)
  const demoSite = process.env.DEMO_URL

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px] rounded-xl border border-border bg-surface p-8 text-center shadow-card">
        <div className="font-logo mb-1 text-[38px] leading-none text-ink">SF</div>
        <div className="mb-6 text-[13.5px] text-ink-2">{t('loginRequired', lang)}</div>

        <LoginForm lang={lang} />
        <div className="mt-4 text-[12.5px] text-ink-2">
          {t('noAccount', lang)}{' '}
          <Link href="/register" className="font-semibold text-accent hover:underline">
            {t('createAccount', lang)}
          </Link>
        </div>

        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted">
          <span className="h-px flex-1 bg-border" /> {t('orSep', lang)} <span className="h-px flex-1 bg-border" />
        </div>

        {hasGithub && (
          <Link
            href="/api/auth/github"
            className="mb-3 flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-[14px] font-semibold text-primary-fg"
          >
            <GithubMark /> {t('signInGithub', lang)}
          </Link>
        )}

        {demoSite ? (
          <a
            href={demoSite}
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-[14px] font-semibold ${
              hasGithub ? 'border border-border text-ink' : 'bg-primary text-primary-fg'
            }`}
          >
            {t('tryLiveDemo', lang)}
          </a>
        ) : (
          <form action="/api/auth/demo" method="post">
            <button
              className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-[14px] font-semibold ${
                hasGithub ? 'border border-border text-ink' : 'bg-primary text-primary-fg'
              }`}
            >
              {t('signInDemo', lang)}
            </button>
          </form>
        )}

        {sp.e && (
          <div className="mt-4 text-[12px] text-danger">
            {sp.e === 'no_github'
              ? lang === 'ru'
                ? 'GitHub OAuth не настроен — используйте demo-вход.'
                : 'GitHub OAuth is not configured — use the demo sign-in.'
              : `Auth error: ${sp.e}`}
          </div>
        )}

        <Link href="/" className="mt-6 inline-block text-[12.5px] text-ink-2 hover:text-ink">
          ← SetFork
        </Link>
      </div>
    </div>
  )
}

function GithubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.49-1.11-1.49-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.35 9.35 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  )
}

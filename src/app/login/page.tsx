import Link from "next/link";
import { getSession } from "@/shared/auth/session";
import { oauthEnabled, demoLoginEnabled } from "@/shared/auth/oauth";
import { getLang } from "@/shared/i18n/server";
import { t } from "@/shared/i18n";
import { redirect } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Alert } from "@/shared/ui/Alert";
import { LoginForm } from "@/features/auth/AuthForms";
import { PasskeyLoginButton } from "@/features/auth/PasskeyLoginButton";
import { cardClass } from '@/shared/ui/card-style'
import { buttonClass } from "@/shared/ui/button-style"

export async function generateMetadata() {
  const lang = await getLang();
  return { title: t("signIn", lang) };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; reset?: string }>;
}) {
  const [lang, session, sp] = await Promise.all([
    getLang(),
    getSession(),
    searchParams,
  ]);
  if (session) redirect("/");
  // Провайдеры включаются кредами в env; AUTH_DISABLED_PROVIDERS скрывает не удаляя
  // (RU-прод: github выключен, на .com может остаться). См. shared/auth/oauth.
  const oauth = oauthEnabled();
  const hasOauth = oauth.github || oauth.yandex || oauth.vk;
  // Публичный demo-вход: на проде выключен (AUTH_DISABLED_PROVIDERS=...,demo) —
  // каталог и поиск и так открыты анонимно, общий demo-аккаунт не нужен.
  const hasDemoLogin = demoLoginEnabled();
  // На проде задаётся DEMO_URL=https://demo.setfork.com → «demo» ведёт в изолированную
  // песочницу (там свой богатый контент), а не логинит пустого юзера в прод-базе. На
  // самом demo-сайте эту переменную НЕ задаём — там обычный demo-вход. (Серверный
  // компонент читает рантайм-env, поэтому НЕ NEXT_PUBLIC — меняется без пересборки.)
  const demoSite = process.env.DEMO_URL;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className={cardClass({ pad: 'lg', className: 'w-full max-w-form text-center shadow-card' })}>
        <div className="font-logo mb-1 text-logo leading-none text-ink">
          SF
        </div>
        <div className="mb-6 text-body-lg text-ink-2">
          {t("loginRequired", lang)}
        </div>

        {sp.reset === "1" && (
          <Alert variant="ok" className="mb-4 text-left">
            {lang === "ru"
              ? "Пароль изменён — войди с новым."
              : "Password changed — sign in with the new one."}
          </Alert>
        )}
        <LoginForm lang={lang} />
        <div className="mt-4 text-body-sm text-ink-2">
          {t("noAccount", lang)}{" "}
          <Link
            href="/register"
            className="font-semibold text-accent hover:underline"
          >
            {t("createAccount", lang)}
          </Link>
        </div>

        <div className="my-5 flex items-center gap-3 text-caption uppercase tracking-wider text-muted">
          <span className="h-px flex-1 bg-border" /> {t("orSep", lang)}{" "}
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="mb-3">
          <PasskeyLoginButton lang={lang} />
        </div>

        {oauth.yandex && (
          <Link
            href="/api/auth/yandex"
            className={buttonClass({ variant: "primary", size: "lg", className: "mb-3 w-full" })}
          >
            <YandexMark /> {t("signInYandex", lang)}
          </Link>
        )}

        {oauth.telegram && (
          <Link
            href="/api/auth/telegram"
            className={buttonClass({ variant: "primary", size: "lg", className: "mb-3 w-full" })}
          >
            <TelegramMark /> {t("signInTelegram", lang)}
          </Link>
        )}

        {oauth.vk && (
          <Link
            href="/api/auth/vk"
            className={buttonClass({ variant: "primary", size: "lg", className: "mb-3 w-full" })}
          >
            <VkMark /> {t("signInVk", lang)}
          </Link>
        )}

        {oauth.github && (
          <Link
            href="/api/auth/github"
            className={buttonClass({ variant: "primary", size: "lg", className: "mb-3 w-full" })}
          >
            <GithubMark /> {t("signInGithub", lang)}
          </Link>
        )}

        {demoSite ? (
          <a
            href={demoSite}
            // Ступень lg — та же, что у кнопок входа рядом: ряд входа обязан быть
            // одной высоты, а не собираться из py-3 на глаз.
            className={buttonClass({ variant: hasOauth ? "outline" : "primary", size: "lg", className: "w-full" })}
          >
            {t("tryLiveDemo", lang)}
          </a>
        ) : (
          hasDemoLogin && (
            <form action="/api/auth/demo" method="post">
              <Button
                type="submit"
                variant={hasOauth ? "outline" : "primary"}
                size="lg"
                className={`w-full ${hasOauth ? "bg-transparent" : ""}`}
              >
                {t("signInDemo", lang)}
              </Button>
            </form>
          )
        )}

        {sp.e && (
          <div className="mt-4 text-body-sm text-danger">
            {sp.e === "oauth_off" || sp.e === "no_github"
              ? lang === "ru"
                ? "Этот способ входа не настроен — выберите другой."
                : "This sign-in method is not configured — pick another one."
              : sp.e === "2fa_throttled"
                ? lang === "ru"
                  ? "Слишком много попыток кода 2FA — войди заново через несколько минут."
                  : "Too many 2FA attempts — sign in again in a few minutes."
                : `Auth error: ${sp.e}`}
          </div>
        )}

        <Link
          href="/"
          className="mt-6 inline-block text-body-sm text-ink-2 hover:text-ink"
        >
          ← SetFork
        </Link>
      </div>
    </div>
  );
}

// Брендовые знаки — КАНОНИЧЕСКИЕ контуры (те же, что в devon-store-frontend).
// Важно не рисовать «похожие» от руки: провайдер может отклонить приложение на
// OAuth-верификации, если кнопка расходится с бренд-гайдом
// (Яндекс: yandex.ru/dev/id/doc — красный #FC3F1D круг + белая «Я»).
function YandexMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M2.04 12c0-5.523 4.476-10 10-10 5.522 0 10 4.477 10 10s-4.478 10-10 10c-5.524 0-10-4.477-10-10z"
        fill="#FC3F1D"
      />
      <path
        d="M13.32 7.666h-.924c-1.694 0-2.585.858-2.585 2.123 0 1.43.616 2.1 1.881 2.959l1.045.704-3.003 4.487H7.49l2.695-4.014c-1.55-1.111-2.42-2.19-2.42-4.015 0-2.288 1.595-3.85 4.62-3.85h3.003v11.868H13.32V7.666z"
        fill="#fff"
      />
    </svg>
  );
}

// Telegram: канонический «самолётик» (тот же контур, что public/telegram.svg
// в devon-store-frontend / simple-icons) на фирменном синем #26A5E4.
function TelegramMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#26A5E4" />
      <path
        d="M16.906 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
        fill="#fff"
      />
    </svg>
  );
}

// VK ID: канонический brand mark на фирменном синем (#0077FF).
function VkMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="6" fill="#0077FF" />
      <path
        d="M19 8.4c.1-.4 0-.6-.6-.6h-2c-.5 0-.7.3-.8.6 0 0-1 2.5-2.4 4.1-.5.5-.7.6-1 .6-.1 0-.4-.2-.4-.6V8.4c0-.5-.2-.6-.6-.6H8c-.3 0-.5.2-.5.4 0 .4.7.5.7 1.8v2.7c0 .6-.1.7-.4.7-.6 0-2.2-2.5-3.1-5.4 0 0-.2-.6-.7-.6H1.8c-.6 0-.7.3-.7.6 0 .5.6 3.2 3.2 6.6 1.7 2.4 4.1 3.7 6.4 3.7 1.3 0 1.5-.3 1.5-.8v-1.8c0-.5.1-.7.5-.7.3 0 .8.1 1.9 1.2 1.3 1.3 1.5 1.9 2.3 1.9h2c.6 0 .8-.3.7-.8-.2-.7-1.6-2.2-1.7-2.3-.3-.4-.4-.5 0-1 .3-.4 1.7-2.4 1.9-3.2z"
        fill="#fff"
        transform="translate(1.5 1.5) scale(0.875)"
      />
    </svg>
  );
}

function GithubMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.49-1.11-1.49-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.35 9.35 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}

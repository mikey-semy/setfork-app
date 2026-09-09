import { readFileSync } from 'node:fs'

// Версия приложения — единый источник — package.json. Инлайним на сборке в
// NEXT_PUBLIC_APP_VERSION, чтобы её видели и сервер (футер), и клиент (баннер
// обновления) без чтения файла в рантайме (standalone-образ package.json не тащит целиком).
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

// Разрешённые origin'ы для Server Actions (Next сам сверяет Origin↔Host для CSRF).
// Same-origin проходит всегда; тут добавляем прод-домен на случай прокси, где Host отличается.
const serverActionOrigins = ['localhost:3000']
if (process.env.NEXT_PUBLIC_SITE_URL) {
  try {
    serverActionOrigins.push(new URL(process.env.NEXT_PUBLIC_SITE_URL).host)
  } catch {
    /* невалидный URL — игнорируем */
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Прокидываем версию в бандл (клиент+сервер) — читается через shared/app-version.
  env: { NEXT_PUBLIC_APP_VERSION: pkgVersion },
  // Компактный self-contained сервер (.next/standalone) для Docker-образа.
  output: 'standalone',
  // ⛔ `images.remotePatterns` ЗДЕСЬ НЕТ НАМЕРЕННО, и возвращать его нельзя без
  // живого потребителя. Любой разрешённый паттерн включает `/_next/image` —
  // эндпоинт оптимизации, который отвечает АНОНИМУ и прогоняет чужой файл через
  // декодеры Next (AVIF/HEIF). Мы держали там `avatars.githubusercontent.com`, хотя
  // `next/image` в коде не импортируется НИ РАЗУ: настройка была мёртвой, а
  // поверхность живой — замер с прода 09.09.2026 давал 200 на разрешённый источник
  // и 400 на посторонний, то есть эндпоинт работал.
  //
  // Разрешённый домен тут не защита, а приглашение: аватар на GitHub ставит себе
  // кто угодно, то есть файл на «доверенном» домене выбирает атакующий. Ровно этим
  // путём достигался критический CVE в Image Optimization API (AVIF) до 16.3.3.
  experimental: {
    serverActions: { allowedOrigins: serverActionOrigins },
  },
  // Базовые security-заголовки на все ответы. nosniff — критично для отдачи
  // пользовательских вложений (браузер не MIME-sniff-ит файл в html/script).
  // X-Frame-Options и полный CSP тут НЕ ставим глобально: embed-роут намеренно
  // фреймится (frame-ancestors *), а CSP script-src требует nonce для inline-темы.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig

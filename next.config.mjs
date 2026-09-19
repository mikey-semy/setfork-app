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
    // HSTS: год, с поддоменами. Проверено 19.09.2026 — `stats`, `docs`, `mail` и `www`
    // отвечают по HTTPS, а http отдаёт 301 на https, поэтому включение поддоменов
    // ничего не отрезает. `preload` НЕ ставим: это заявка в список браузеров, откуда
    // выписываются месяцами, и делать её надо осознанным отдельным шагом.
    const hsts = { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }
    // Разрешения браузера, которыми мы не пользуемся. Пустой список = «никому, включая
    // нас»: если однажды понадобится камера, строка станет местом осознанного решения,
    // а не забытым запретом. `fullscreen` НЕ трогаем — его просит встроенное видео.
    const permissions = {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    }
    const base = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      hsts,
      permissions,
    ]
    return [
      {
        // ⚠️ ВСЁ, КРОМЕ адреса, ОКАНЧИВАЮЩЕГОСЯ на `/embed`. Запрет на чужие рамки
        // ставится здесь, а не глобально: embed-роут для того и существует, чтобы его
        // вставляли к себе. Две записи с разными CSP на один адрес дали бы ДВА заголовка,
        // а браузер применяет их пересечение — то есть самый строгий, и встраивание молча
        // перестало бы работать.
        // `$` на конце обязателен: без него исключение ловило любой адрес, ГДЕ ВСТРЕЧАЕТСЯ
        // «embed», — а ник и слаг пишет пользователь. `/embedder/my-list` и
        // `/alice/embedded-guide` оставались бы вообще без защитных заголовков.
        source: '/:path((?!.*/embed$).*)',
        headers: [...base, { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }],
      },
      {
        // Встраиваемая страница: рамки разрешены кому угодно, остальное — как везде.
        source: '/:handle/:slug/embed',
        headers: base,
      },
    ]
  },
}

export default nextConfig

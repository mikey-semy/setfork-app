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
  // Компактный self-contained сервер (.next/standalone) для Docker-образа.
  output: 'standalone',
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }],
  },
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

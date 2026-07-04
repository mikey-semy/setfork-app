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
}

export default nextConfig

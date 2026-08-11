/**
 * Корневые сегменты приложения, чей первый сегмент пути — НЕ handle пользователя.
 * Нужен шапке (TopNav): всё, чего здесь нет, она рисует как профиль-крамб
 * «SF @handle». Список ОБЯЗАН совпадать с каталогами src/app — расхождение
 * уже давало «SF guilds» в шапке гильдий (линза 07); синхрон держит юнит
 * tests/shared/nav/reserved-top.test.ts, который сверяет его с файловой системой.
 */
export const RESERVED_TOP = new Set([
  'about',
  'admin',
  'api',
  'change-email',
  'changelog',
  'collections',
  'explore',
  'feedback',
  'forgot-password',
  'generate',
  'guilds',
  'improve',
  'login',
  'my-lists',
  'new',
  'notifications',
  'privacy',
  'register',
  'reset-password',
  'runs',
  'search',
  'settings',
  'tags',
  'terms',
  'unsubscribe',
  'verify-email',
])

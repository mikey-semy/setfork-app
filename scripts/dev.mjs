// Запуск dev-сервера с пределом JS-кучи — одинаково на всех системах.
//
// ⚠️ Почему не `NODE_OPTIONS=... next dev` прямо в скрипте package.json: npm запускает
// скрипты через оболочку системы, и на Windows это `cmd.exe`, который читает
// `NODE_OPTIONS=--max-old-space-size=2048` как ИМЯ КОМАНДЫ и падает, не дойдя до Next.
// Проект открытый, репозиторий клонируют под Windows, и «npm run dev не работает» —
// плохая первая встреча с ним. (Найдено авто-ревью 22.09.2026.)
//
// Зависимости вроде cross-env ради одной строки не заводим: в проекте её нет, а лишняя
// зависимость в сборке дороже пятнадцати строк своего кода.
//
// Зачем предел вообще: на редакторе списка в 120 пунктов куча next-server дорастает до
// 2 ГБ за пять с половиной минут и не останавливается. Без предела она идёт до
// умолчания V8 (здесь 4288 МБ), машина начинает выгружать всё подряд, и вместе с dev
// умирает редактор — 22.09.2026 так и случилось. С пределом падает только сборка.
//
// ⚠️ Предел V8 ограничивает ТОЛЬКО JS-часть. Нативная часть Turbopack живёт вне кучи,
// и против неё нужен `MemoryMax` в юните systemd — см. docs/dev-server-unit.md.
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const HEAP_MB = Number(process.env.SETFORK_DEV_HEAP_MB ?? 2048)

// Дописываем к уже заданным настройкам, а не затираем их: снаружи может прийти свой
// NODE_OPTIONS (отладчик, флаги профилирования), и молча его потерять — плохой сюрприз.
const existing = process.env.NODE_OPTIONS ?? ''
process.env.NODE_OPTIONS = `${existing} --max-old-space-size=${HEAP_MB}`.trim()

const root = new URL('..', import.meta.url).pathname
// `.bin/next` на Windows — это `next.cmd`, и запустить его напрямую нельзя; поэтому зовём
// сам файл Next через текущий node, минуя оболочку вовсе.
const next = join(root, 'node_modules', 'next', 'dist', 'bin', 'next')

const child = spawn(process.execPath, [next, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))

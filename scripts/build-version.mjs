/**
 * Номер версии приложения — из git, а не из package.json.
 *
 * В package.json стоит `0.1.0` с первого коммита проекта: никто его не бампает, и
 * футер всё это время показывал одно и то же число независимо от того, что собрано.
 * Номер, который не меняется, хуже отсутствующего — по нему нельзя сказать, та ли
 * это сборка.
 *
 * Считаем так же, как в соседнем проекте: `0.<сколько feat>.<сколько правок после
 * последнего feat>`. Тегов в репозитории нет, а порядок нужен.
 *
 * ⚠️ Истории может не быть. `.git` стоит в `.dockerignore`, поэтому ВНУТРИ образа
 * этот скрипт не сработает никогда — его зовёт CI ДО `docker build` и передаёт
 * результат аргументом сборки. Если истории нет (архив, мелкая копия), возвращаем
 * пустую строку: пусть интерфейс скажет «неизвестно», а не выдумает число.
 */
import { execSync } from 'node:child_process'

const TYPES = /^(feat|fix|docs|refactor|perf|test|chore|build|ci|style|revert)(\(|!|:)/i

// Рабочий каталог передаётся ОПЦИЕЙ, а не куском команды: путь с пробелом (а такой
// бывает у checkout на своём раннере) развалил бы строку, и git прочитал бы её как
// несколько аргументов. Вызов и так идёт без шелла — аргументы разбирает не оболочка.
// ⚠️ Ошибка git НЕ ГЛОТАЕТСЯ. Прежняя редакция возвращала пустоту одинаково и когда
// истории нет, и когда git отказал, — и выкатка 21.09.2026 прошла с номером из
// package.json, сказав только «посчитать не удалось». Причина осталась неизвестной,
// потому что её никто не напечатал. Теперь она уезжает в stderr: stdout остаётся
// чистым (его читает подстановка в CI), а человек видит, что именно случилось.
//
// `safe.directory` — отдельная мера: actions/checkout прописывает его во ВРЕМЕННЫЙ
// HOME и возвращает прежний сразу после своего шага, так что на нашем шаге записи
// уже нет. Каталог сборки принадлежит тому, кто его создал, и git вправе отказаться
// читать чужой репозиторий.
function git(args, cwd) {
  try {
    return execSync(`git -c safe.directory='*' ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (e) {
    const why = (e?.stderr || e?.message || String(e)).toString().trim().split('\n')[0]
    process.stderr.write(`build-version: git ${args} → ${why}\n`)
    return ''
  }
}

/** Виды изменений по всей истории, от старых к новым. */
export function commitTypes(log) {
  return log
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((subject) => {
      const m = TYPES.exec(subject)
      return m ? m[1].toLowerCase() : 'other'
    })
}

/** `0.<feat>.<правок после последнего feat>` — чистая функция ради тестов. */
export function versionOf(types) {
  const feats = types.filter((t) => t === 'feat').length
  const lastFeat = types.lastIndexOf('feat')
  const patch = lastFeat < 0 ? types.length : types.length - lastFeat - 1
  return `0.${feats}.${patch}`
}

export function buildVersion(cwd = process.cwd()) {
  // Мелкая копия истории не содержит: номер по ней был бы неверным, а не приблизительным.
  const shallow = git('rev-parse --is-shallow-repository', cwd) === 'true'
  const log = git('log --reverse --format=%s', cwd)
  if (shallow || !log) return ''
  return versionOf(commitTypes(log))
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(buildVersion())

// Папка скилла → вход publish_skill. Правила — как у стандарта и у сервера: SKILL.md в
// корне, файлы прямо в scripts/, references/, assets/ (один уровень). Всё, что сверх этого,
// называется, а не пропускается молча: иначе человек думал бы, что опубликовал файл.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const SKILL_DIRS = ['scripts', 'references', 'assets']

export function readSkillDir(dir) {
  const skillMd = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  const files = []
  const skipped = []
  for (const sub of SKILL_DIRS) {
    let names = []
    try {
      names = readdirSync(join(dir, sub))
    } catch {
      continue
    }
    for (const name of names.sort()) {
      const full = join(dir, sub, name)
      const st = statSync(full)
      if (!st.isFile()) {
        skipped.push(`${sub}/${name} (not a file — subfolders are not part of a skill here)`)
        continue
      }
      const bytes = readFileSync(full)
      const binary = bytes.includes(0)
      // Двоичное сервер берёт только из assets/ (байты — в хранилище по хешу); в scripts/ и
      // references/ — только текст, их читают глазами.
      if (binary && sub !== 'assets') {
        skipped.push(`${sub}/${name} (binary — binary files are kept only in assets/)`)
        continue
      }
      const file = binary
        ? { path: `${sub}/${name}`, content: bytes.toString('base64'), encoding: 'base64' }
        : { path: `${sub}/${name}`, content: bytes.toString('utf8') }
      // Режим — только для scripts/: сервер пускает исполняемые только там.
      if (sub === 'scripts') file.executable = (st.mode & 0o111) !== 0
      files.push(file)
    }
  }
  const extra = readdirSync(dir).filter((n) => n !== 'SKILL.md' && !SKILL_DIRS.includes(n) && !n.startsWith('.'))
  for (const n of extra) skipped.push(`${n} (outside SKILL.md and the three folders)`)
  return { skillMd, files, skipped }
}

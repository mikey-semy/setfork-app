#!/usr/bin/env node
// sf — минимальный CLI для SetFork: клон/скрипт/открыть список.
// Тонкая обёртка над git и /raw-эндпоинтом; без зависимостей.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { baseUrl, cloneUrl, pageUrl, rawUrl } from './lib.mjs'

const [, , cmd, ...args] = process.argv

const HELP = `sf — SetFork CLI

Usage:
  sf clone <owner/slug> [dir]   git clone the list repository
  sf raw   <owner/slug>         print the runnable script to stdout
  sf url   <owner/slug>         print the list page URL
  sf open  <owner/slug>         open the list in your browser
  sf version | help

Env:
  SETFORK_URL   instance base (default ${baseUrl()})

Examples:
  sf clone ranger-rae/building-a-campfire-safely
  sf raw ranger-rae/utilities-outage-plan | less
  SETFORK_URL=http://localhost:3000 sf url alice/deploy`

function die(msg) {
  console.error(msg)
  process.exit(1)
}

function openInBrowser(url) {
  const [bin, pre] =
    process.platform === 'darwin' ? ['open', []] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '']] : ['xdg-open', []]
  spawnSync(bin, [...pre, url], { stdio: 'ignore' })
}

try {
  switch (cmd) {
    case 'clone': {
      if (!args[0]) die('usage: sf clone <owner/slug> [dir]')
      const r = spawnSync('git', ['clone', cloneUrl(args[0]), ...(args[1] ? [args[1]] : [])], { stdio: 'inherit' })
      process.exit(r.status ?? 0)
      break
    }
    case 'raw': {
      if (!args[0]) die('usage: sf raw <owner/slug>')
      const res = await fetch(rawUrl(args[0]))
      if (!res.ok) die(`fetch failed: ${res.status} ${res.statusText}`)
      process.stdout.write(await res.text())
      break
    }
    case 'url':
      if (!args[0]) die('usage: sf url <owner/slug>')
      console.log(pageUrl(args[0]))
      break
    case 'open': {
      if (!args[0]) die('usage: sf open <owner/slug>')
      const u = pageUrl(args[0])
      openInBrowser(u)
      console.log(u)
      break
    }
    case 'version':
    case '--version':
    case '-v': {
      const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))
      console.log(pkg.version)
      break
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      break
    default:
      die(`unknown command "${cmd}"\n\n${HELP}`)
  }
} catch (e) {
  die(e instanceof Error ? e.message : String(e))
}

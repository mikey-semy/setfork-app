// Честное покрытие = unit + integration. `npm run test:coverage` видит только юниты,
// поэтому data-layer (queries/actions/mcp/moderation), покрытый *.itest.ts, показывает
// 0%. Этот скрипт сливает два coverage-final.json (istanbul-формат) в один процент.
//
// Как получить (нужен Postgres для интеграции):
//   npx vitest run --coverage --coverage.reporter=json --coverage.reportsDirectory=coverage/unit
//   DATABASE_URL=... npx vitest run --config vitest.integration.config.ts \
//     --coverage --coverage.reporter=json --coverage.reportsDirectory=coverage/integration
//   node scripts/coverage-merge.mjs coverage/unit/coverage-final.json coverage/integration/coverage-final.json
import { readFileSync } from 'node:fs'
import libCoverage from 'istanbul-lib-coverage'

const args = process.argv.slice(2)
const minIdx = args.indexOf('--min')
const min = minIdx >= 0 ? Number(args[minIdx + 1]) : null
const files = args.filter((a, i) => !a.startsWith('--') && i !== minIdx + 1)
if (files.length < 1) {
  console.error('usage: node scripts/coverage-merge.mjs <coverage-final.json> [more...] [--min <pct>]')
  process.exit(1)
}
const map = libCoverage.createCoverageMap({})
for (const f of files) map.merge(JSON.parse(readFileSync(f, 'utf8')))

const total = libCoverage.createCoverageSummary()
for (const f of map.files()) total.merge(map.fileCoverageFor(f).toSummary())
const s = total.statements
console.log(`COMBINED statements: ${s.pct.toFixed(2)}%  (${s.covered}/${s.total})`)

if (min != null) {
  if (s.pct < min) {
    console.error(`FAIL: покрытие ${s.pct.toFixed(2)}% ниже порога ${min}%`)
    process.exit(1)
  }
  console.log(`OK: порог ${min}% выдержан`)
}

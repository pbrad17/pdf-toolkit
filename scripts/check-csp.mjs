/**
 * Assert that the two copies of the Content-Security-Policy agree.
 *
 * The policy has to exist twice — as a meta tag for anyone serving the built
 * files themselves, and as a Vercel header so it also covers the worker script
 * and can carry frame-ancestors, which browsers ignore in a meta tag. Two
 * copies drift. This fails loudly when they do.
 *
 * Run: node scripts/check-csp.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Directives allowed to appear only in the header, because meta ignores them. */
const HEADER_ONLY = new Set(['frame-ancestors'])

const parse = (policy) => new Map(
  policy
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...sources] = part.split(/\s+/)
      return [name.toLowerCase(), sources.join(' ')]
    }),
)

const html = readFileSync(join(root, 'index.html'), 'utf8')
const metaMatch = /<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i.exec(html)
if (!metaMatch) fail('index.html has no Content-Security-Policy meta tag.')

const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
const headerValue = vercel.headers
  ?.flatMap(entry => entry.headers ?? [])
  .find(h => h.key.toLowerCase() === 'content-security-policy')?.value
if (!headerValue) fail('vercel.json has no Content-Security-Policy header.')

const meta = parse(metaMatch[1])
const header = parse(headerValue)
const problems = []

for (const [name, sources] of header) {
  if (HEADER_ONLY.has(name)) {
    if (meta.has(name)) problems.push(`${name} is header-only but appears in the meta tag`)
    continue
  }
  if (!meta.has(name)) problems.push(`${name} is in the header but missing from the meta tag`)
  else if (meta.get(name) !== sources) {
    problems.push(`${name} differs — meta: "${meta.get(name)}", header: "${sources}"`)
  }
}
for (const name of meta.keys()) {
  if (!header.has(name)) problems.push(`${name} is in the meta tag but missing from the header`)
}

if (problems.length > 0) fail(`CSP mismatch:\n  - ${problems.join('\n  - ')}`)

console.log(`CSP in sync across index.html and vercel.json (${header.size} directives).`)

function fail(message) {
  console.error(message)
  process.exit(1)
}

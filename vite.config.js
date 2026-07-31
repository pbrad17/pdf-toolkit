import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Sources the dev server needs that the shipped policy must never grant. */
const DEV_SOURCES = {
  'script-src': ["'unsafe-inline'", "'unsafe-eval'"],
  'connect-src': ['ws:', 'wss:'],
}

const CSP_META = /(<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*content=")([^"]*)(")/i

/**
 * Serve a loosened CSP in development only.
 *
 * The policy in index.html is strict enough to break `vite dev`:
 * @vitejs/plugin-react injects its Fast Refresh preamble as an inline script,
 * and HMR talks over a WebSocket. The obvious fix — adding 'unsafe-inline' and
 * ws: to the tag — would ship those grants to production and quietly void the
 * guarantee the policy exists to make.
 *
 * This patches the served copy instead, and derives it from the tag in
 * index.html rather than restating the policy, so the two cannot drift.
 */
function relaxCspForDev() {
  return {
    name: 'relax-csp-for-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      if (!CSP_META.test(html)) {
        throw new Error(
          'relax-csp-for-dev: no Content-Security-Policy meta tag found in index.html. ' +
          'Either it was removed — which drops the app\'s main exfiltration guard — or it was ' +
          'reformatted past this plugin\'s matcher. Fix one or the other; do not delete this plugin.',
        )
      }
      return html.replace(CSP_META, (_all, open, policy, close) => {
        const relaxed = policy.split(';').map((directive) => {
          const extra = DEV_SOURCES[directive.trim().split(/\s+/)[0]]
          return extra ? `${directive.trimEnd()} ${extra.join(' ')}` : directive
        }).join(';')
        return open + relaxed + close
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), relaxCspForDev()],
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
})

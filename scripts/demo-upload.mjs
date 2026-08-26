// Publishes the demo to https://jbrowse.org/demos/tview/.
//
//   pnpm demos:upload            build, upload, invalidate
//   pnpm demos:upload --dry-run  say what it would do
//
// Two files: the config the links name, and the plugin bundle the config names.
// Both are served from jbrowse.org, which is the origin the JBrowse in those
// links is on — that is what keeps jbrowse-web's cross-origin plugin prompt out
// of the way of a visitor who just clicked a link in the README.
//
// The bundle is the one `pnpm build` just produced, so the demo shows the code
// the figures were taken from. That is deliberately not npm: a demo should not
// wait on a release, and a release should not be forced by a demo.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const BUCKET = 's3://jbrowse.org/demos/tview'
const DISTRIBUTION = 'E13LGELJOT4GQO'
const BUNDLE = 'dist/jbrowse-plugin-tview.umd.production.min.js'
const CONFIG = 'public/demo.json'

// Neither file is versioned in its name, so both have to be revalidated rather
// than cached for a year — the same reason jbrowse-plugin-list uploads its
// `latest/` paths this way.
const CACHE = 'Cache-Control: no-cache, must-revalidate'

const dryRun = process.argv.includes('--dry-run')

for (const file of [BUNDLE, CONFIG]) {
  if (!fs.existsSync(file)) {
    throw new Error(`${file} is missing; run: pnpm build && pnpm demos`)
  }
}

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  if (!dryRun) {
    // AWS_PAGER empty or create-invalidation stops in a pager and waits
    execFileSync(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, AWS_PAGER: '' },
    })
  }
}

// `plugin.js` rather than the bundle's own name: what the demo needs is a
// stable url for the config to point at, and the built filename says
// "production.min" about a file nobody chose by name.
run('aws', [
  's3',
  'cp',
  BUNDLE,
  `${BUCKET}/plugin.js`,
  '--content-type',
  'application/javascript',
  '--cache-control',
  CACHE.replace('Cache-Control: ', ''),
])
run('aws', [
  's3',
  'cp',
  CONFIG,
  `${BUCKET}/config.json`,
  '--content-type',
  'application/json',
  '--cache-control',
  CACHE.replace('Cache-Control: ', ''),
])
run('aws', [
  'cloudfront',
  'create-invalidation',
  '--distribution-id',
  DISTRIBUTION,
  '--paths',
  '/demos/tview/*',
])

console.log(
  dryRun
    ? '\ndry run; nothing uploaded'
    : '\nhttps://jbrowse.org/demos/tview/config.json is live',
)

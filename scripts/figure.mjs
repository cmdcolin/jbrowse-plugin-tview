// Regenerates the figures in img/ that come from the fixtures in public/.
//   pnpm figure                   all of them
//   pnpm figure modifications     just the named ones
//
// The figures are defined in lib/figures.mjs and taken by lib/capture.mjs,
// which starts its own dev server on FIGURE_PORT (9000 by default).
import { captureFigures } from './lib/capture.mjs'
import { LOCAL_FIGURES } from './lib/figures.mjs'

const only = process.argv.slice(2)
const wanted = only.length
  ? LOCAL_FIGURES.filter(f => only.includes(f.name))
  : LOCAL_FIGURES
if (!wanted.length) {
  throw new Error(
    `no figure named ${only.join(', ')}; there are ${LOCAL_FIGURES.map(f => f.name).join(', ')}`,
  )
}

const { failed } = await captureFigures(wanted)
if (failed.length) {
  console.error(
    `\n${failed.length} of ${wanted.length} failed: ${failed.join(', ')}`,
  )
  process.exitCode = 1
}

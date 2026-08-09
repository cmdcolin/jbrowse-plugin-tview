// Regenerates the tandem-repeat figures in img/.
//   pnpm figures:repeats            all of them
//   pnpm figures:repeats fmr1       just the named ones
//
// The figures are defined in lib/figures.mjs and taken by lib/capture.mjs;
// this is only which of them were asked for.
import { captureFigures } from './lib/capture.mjs'
import { FIGURES } from './lib/figures.mjs'

const only = process.argv.slice(2)
const wanted = only.length
  ? FIGURES.filter(f => only.includes(f.name))
  : FIGURES
if (!wanted.length) {
  throw new Error(
    `no figure named ${only.join(', ')}; there are ${FIGURES.map(f => f.name).join(', ')}`,
  )
}

const { failed } = await captureFigures(wanted)
if (failed.length) {
  console.error(
    `\n${failed.length} of ${wanted.length} failed: ${failed.join(', ')}`,
  )
  process.exitCode = 1
}

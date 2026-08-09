// Writes the measured numbers in README.md, between the markers that name
// them.
//
//   pnpm readme:repeats           measure the trio and rewrite the blocks
//   pnpm readme:repeats --check   fail if what is written is not what it measures
//
// Every number the README states about the trio is in one of these blocks, so
// it is a rendering of a measurement rather than a claim someone typed once and
// nobody could check afterwards. --check is the part that makes it a claim
// again only if it passes.
import fs from 'node:fs'

import { FIGURES } from './lib/figures.mjs'
import { GENOME, LOCI, TRIO, TRIO_REPORT_ORDER } from './lib/giabTrio.mjs'
import { measureLoci } from './lib/measure.mjs'

const README = 'README.md'

/** the array a locus is named for: the one the rows were ordered by */
function subjectArray(measurement) {
  return measurement.arrays.find(a => a.subject) ?? measurement.arrays[0]
}

function sampleStats(array, sample) {
  return array?.samples.find(s => s.sample === sample)
}

/** `31 / 38`, or `31` where the reads only support one, or `-` where none */
function alleles(stats) {
  return stats?.modes.length
    ? stats.modes.map(t => t.value).join(' / ')
    : stats?.spanning
      ? 'none called'
      : '-'
}

function header(sample) {
  const { role } = TRIO.find(t => t.id === sample)
  return `${sample} (${role})`
}

function table(rows) {
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map(r => String(r[i]).length)),
  )
  const line = cells =>
    `| ${cells.map((c, i) => String(c).padEnd(widths[i])).join(' | ')} |`
  return [
    line(rows[0]),
    `| ${widths.map(w => '-'.repeat(w)).join(' | ')} |`,
    ...rows.slice(1).map(line),
  ].join('\n')
}

function genotypeBlock(measurements) {
  return table([
    ['locus', 'ref', ...TRIO_REPORT_ORDER.map(header)],
    ...measurements.map(m => {
      const array = subjectArray(m)
      return [
        m.locus.name,
        array?.referenceCopies ?? '-',
        ...TRIO_REPORT_ORDER.map(s => alleles(sampleStats(array, s))),
      ]
    }),
  ])
}

function spreadBlock(measurements) {
  return table([
    ['locus', 'array', 'spanning reads', 'on an allele', 'off one'],
    ...measurements.map(m => {
      const array = subjectArray(m)
      const stats = TRIO_REPORT_ORDER.map(s => sampleStats(array, s)).filter(
        s => s !== undefined,
      )
      const spanning = stats.reduce((a, s) => a + s.spanning, 0)
      const off = stats.reduce((a, s) => a + s.offMode, 0)
      return [
        m.locus.name,
        array ? `${array.span}bp of ${array.period}bp unit` : '-',
        spanning,
        spanning - off,
        off,
      ]
    }),
  ])
}

function figureBlock(figureStats) {
  return table([
    ['figure', 'rows', 'columns', 'columns one row has', 'hidden'],
    ...figureStats.map(f => [
      `[${f.name}](${f.out})`,
      f.rows,
      f.columns,
      f.singleRowColumns,
      `${((100 * f.singleRowColumns) / f.columns).toFixed(0)}%`,
    ]),
  ])
}

/** every `<!-- name -->…<!-- /name -->` pair, replaced by what was measured */
function write(markdown, blocks) {
  let ret = markdown
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(
      `(<!-- ${name} -->\\n)[\\s\\S]*?(\\n<!-- /${name} -->)`,
      'g',
    )
    if (!re.test(ret)) {
      throw new Error(`README.md has no <!-- ${name} --> block`)
    }
    // blank lines around the table because that is where prettier puts them,
    // and a block prettier would reformat is a block --check can never pass
    ret = ret.replace(re, `$1\n${body}\n$2`)
  }
  return ret
}

const check = process.argv.includes('--check')

const measurements = await measureLoci({
  loci: LOCI,
  sources: TRIO,
  genome: GENOME,
})

// the figures are their own windows, narrower than the QC loci, so their shape
// is measured rather than read off the table above
const figureStats = []
for (const figure of FIGURES) {
  const [measurement] = await measureLoci({
    loci: [figure.locus],
    sources: TRIO.filter(t => figure.tracks.includes(t.id)),
    genome: GENOME,
  })
  figureStats.push({ ...figure, ...measurement })
}

const before = fs.readFileSync(README, 'utf8')
const after = write(before, {
  'repeat-genotypes': genotypeBlock(measurements),
  'repeat-spread': spreadBlock(measurements),
  'repeat-figures': figureBlock(figureStats),
})

if (check) {
  if (before !== after) {
    console.error(
      `${README} does not match what the data measures; run: pnpm readme:repeats`,
    )
    process.exitCode = 1
  } else {
    console.log(`${README} matches the measurements`)
  }
} else {
  fs.writeFileSync(README, after)
  console.log(`wrote the measured blocks into ${README}`)
}

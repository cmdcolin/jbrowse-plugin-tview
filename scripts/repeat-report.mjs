// Measures the tandem arrays in a set of alignment files and reports what it
// found — the numbers behind the figures, without the browser.
//
//   pnpm report:repeats                          the GIAB trio at the known loci
//   pnpm report:repeats --json                   the same, machine readable
//   pnpm report:repeats \
//     --bam HG002=/path/to/HG002.bam \
//     --bam HG003=https://host/HG003.bam \
//     --loc chrX:146,993,400-146,993,800 \
//     --genome hg19 --ref-name X \
//     --fasta /path/to/hs37d5.fa                 instead of the UCSC API
//     --figure img/fmr1.png                      and a picture of the view
//
// The arrays are found in the reference and every file's reads are measured
// over the same intervals, so the copy counts are comparable across the files
// given rather than being one call per file that has to be reconciled after.
import fs from 'node:fs'
import path from 'node:path'

import {
  LABELLED_ROW_HEIGHT,
  captureFigures,
  writeAdhocConfig,
} from './lib/capture.mjs'
import { GENOME, LOCI, TRIO, TRIO_REPORT_ORDER } from './lib/giabTrio.mjs'
import { measureLoci } from './lib/measure.mjs'

function parseArgs(argv) {
  const ret = { bams: [], locs: [], json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) {
        throw new Error(`${arg} needs a value`)
      }
      return v
    }
    if (arg === '--json') {
      ret.json = true
    } else if (arg === '--bam') {
      // id=uri, or a bare uri named after its file
      const raw = value()
      const eq = raw.indexOf('=')
      ret.bams.push(
        eq < 0
          ? {
              id: raw
                .split('/')
                .pop()
                .replace(/\.bam$/, ''),
              uri: raw,
            }
          : { id: raw.slice(0, eq), uri: raw.slice(eq + 1) },
      )
    } else if (arg === '--loc') {
      ret.locs.push(value())
    } else if (arg === '--genome') {
      ret.genome = value()
    } else if (arg === '--ref-name') {
      ret.refName = value()
    } else if (arg === '--fasta') {
      ret.fasta = value()
    } else if (arg === '--figure') {
      ret.figure = value()
    } else {
      throw new Error(`unknown argument ${arg}`)
    }
  }
  return ret
}

/** `chr1:1,000-2,000` or `chr1:1000..2000` */
function parseLoc(loc, refName) {
  const m = /^(.+):([\d,]+)(?:-|\.\.)([\d,]+)$/.exec(loc.trim())
  if (!m) {
    throw new Error(`could not parse locus ${loc}`)
  }
  const chrom = m[1]
  const start = Number(m[2].replaceAll(',', '')) - 1
  const end = Number(m[3].replaceAll(',', ''))
  return {
    name: loc,
    chrom,
    // BAMs are routinely aligned to a reference whose names are not UCSC's, so
    // the sequence and the reads are asked for separately
    refName: refName ?? chrom,
    start,
    end,
  }
}

function bp(n) {
  return `${n.toLocaleString('en-US')}bp`
}

function reportText(measurements, sampleOrder) {
  const lines = []
  for (const m of measurements) {
    lines.push(
      `\n=== ${m.locus.name}  ${m.locus.refName}:${m.locus.start}-${m.locus.end}  ` +
        `${m.reads} reads, ${m.rows} rows x ${m.columns} columns ` +
        `(${m.singleRowColumns} columns one row has a base in, ${m.emptyColumns} none does)`,
    )
    if (!m.arrays.length) {
      lines.push('  no reference array found')
      continue
    }
    for (const array of m.arrays) {
      lines.push(
        `  ${array.subject ? '*' : ' '} ${array.start}-${array.end} ` +
          `${bp(array.span)} period=${array.period} unit=${array.unit} ` +
          `ref=${array.referenceCopies} copies`,
      )
      const order = sampleOrder ?? array.samples.map(s => s.sample)
      for (const sample of order) {
        const s = array.samples.find(x => x.sample === sample)
        if (!s?.spanning) {
          continue
        }
        lines.push(
          `      ${s.sample}: ${s.spanning} spanning reads, ` +
            `alleles ${s.modes.map(t => `${t.value} (${t.reads} reads)`).join(' / ') || 'none called'}, ` +
            `${s.offMode} off them`,
        )
        lines.push(
          `        copies ${s.copies.map(t => `${t.value}x${t.reads}`).join(' ')}`,
        )
      }
    }
  }
  return lines.join('\n')
}

const args = parseArgs(process.argv.slice(2))
const usingTrio = !args.bams.length
const sources = usingTrio ? TRIO : args.bams
const loci = args.locs.length
  ? args.locs.map(loc => parseLoc(loc, args.refName))
  : usingTrio
    ? LOCI
    : (() => {
        throw new Error('--bam needs at least one --loc')
      })()

const measurements = await measureLoci({
  loci,
  sources,
  genome: args.genome ?? GENOME,
  fasta: args.fasta,
})

console.log(
  args.json
    ? JSON.stringify({ sources, measurements }, null, 2)
    : reportText(measurements, usingTrio ? TRIO_REPORT_ORDER : undefined),
)

if (args.figure) {
  // The browser fetches the reads itself rather than being handed what was
  // measured above, so a figure can only be of files it can reach — which
  // writeAdhocConfig is what knows.
  const genome = args.genome ?? GENOME
  const config = writeAdhocConfig({ genome, sources, fasta: args.fasta })
  const ext = path.extname(args.figure)
  // The README's figures carry hand-picked widths because each was looked at.
  // An arbitrary locus gets its shape from what was just measured instead:
  // rows and columns are known before the browser opens, so the view can be
  // sized to them rather than started at a default and grown from the outside.
  const { failed } = await captureFigures(
    measurements.map((m, i) => {
      // the floor is the height a row keeps its label at, not the height a row
      // is legible at: the label is where the copy count is
      const rowHeight = Math.min(
        20,
        Math.max(LABELLED_ROW_HEIGHT, Math.round(700 / m.rows)),
      )
      const colWidth = Math.min(8, Math.max(1, Math.floor(2400 / m.columns)))
      return {
        name: m.locus.name,
        assembly: genome,
        config,
        // one figure per locus, so several of them need somewhere each to go
        out:
          measurements.length === 1
            ? args.figure
            : `${args.figure.slice(0, -ext.length || undefined)}-${i + 1}${ext}`,
        loc: `${m.locus.chrom}:${m.locus.start + 1}..${m.locus.end}`,
        tracks: sources.map(s => s.id),
        colWidth,
        rowHeight,
        // the rows and a row of slack, plus room for the toolbar and the
        // conservation track above them; the harness fits the window to
        // whatever this turns out to be
        height: (m.rows + 1) * rowHeight + 240,
        // read names are long and labelsAlignRight overflows them leftwards,
        // so this is what has to hold them
        treeAreaWidth: 440,
      }
    }),
  )
  fs.rmSync(config.replace(/^\.\.\//, ''), { force: true })
  if (failed.length) {
    process.exitCode = 1
  }
}

// Measures the tandem arrays in a set of alignment files and reports what it
// found — the numbers behind the figures, without the browser.
//
//   pnpm report:repeats                          the GIAB trio at the known loci
//   pnpm report:repeats --json                   the same, machine readable
//   pnpm report:repeats \
//     --bam HG002=/path/to/HG002.bam \
//     --bam HG003=https://host/HG003.bam \
//     --loc chrX:146,993,400-146,993,800 \
//     --genome hg19 --ref-name X
//
// The arrays are found in the reference and every file's reads are measured
// over the same intervals, so the copy counts are comparable across the files
// given rather than being one call per file that has to be reconciled after.
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
})

console.log(
  args.json
    ? JSON.stringify({ sources, measurements }, null, 2)
    : reportText(measurements, usingTrio ? TRIO_REPORT_ORDER : undefined),
)

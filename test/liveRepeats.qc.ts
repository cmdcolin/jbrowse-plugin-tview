/**
 * QC harness: runs the real plan builder over public long-read data at known
 * repeat loci and prints what it measured, so the numbers can be checked
 * against what the locus is known to carry.
 *
 *   pnpm qc:repeats
 *
 * Not a unit test: it fetches tens of megabytes from GIAB and UCSC, and the
 * answer is a judgement rather than an assertion.
 */
import { LOCI, TRIO, fetchReads, referenceSequence } from './liveRepeatsData'
import { planTviewMsa } from '../src/LaunchTView/tview'

function tally(values: number[]) {
  const counts = new Map<number, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts]
    .sort((a, b) => a[0] - b[0])
    .map(([v, n]) => `${v}x${n}`)
    .join(' ')
}

async function main() {
  for (const locus of LOCI) {
    const sequence = await referenceSequence(
      locus.chrom,
      locus.start,
      locus.end,
    )
    const perSample = await Promise.all(
      TRIO.map(s => fetchReads(s.url, locus.refName, locus.start, locus.end)),
    )
    const features = perSample.flat()
    const sampleByIndex = perSample.flatMap((feats, i) =>
      feats.map(() => TRIO[i]!.id),
    )
    const plan = planTviewMsa({
      features,
      refName: locus.refName,
      start: locus.start,
      end: locus.end,
      sequence,
      sampleOf: i => sampleByIndex[i],
    })

    console.log(
      `\n=== ${locus.name}  ${locus.refName}:${locus.start}-${locus.end}  ${features.length} reads, ${plan.layout.totalColumns} columns`,
    )
    if (!plan.arrays.length) {
      console.log('  no reference array found')
      continue
    }
    for (const array of plan.arrays) {
      const isSubject = array === plan.subject
      console.log(
        `  ${isSubject ? '*' : ' '} ${array.start}-${array.end} period=${array.period} unit=${array.unit} ref=${array.copiesByName.get(locus.refName)} copies`,
      )
      for (const sample of TRIO) {
        const copies = [...array.copiesByName]
          .filter(([name]) => name.startsWith(`${sample.id}|`))
          .map(([, n]) => n)
        const lengths = [...array.lengthByName]
          .filter(([name]) => name.startsWith(`${sample.id}|`))
          .map(([, n]) => n)
        if (copies.length) {
          console.log(
            `      ${sample.id} (${sample.role}): ${copies.length} spanning reads, copies ${tally(copies)}, bp ${tally(lengths)}`,
          )
        }
      }
    }
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})

/**
 * Measuring a locus in a set of alignment files, outside the browser.
 *
 * The same plan builder the view runs, over reads fetched straight from the
 * BAMs, so a report and a screenshot of the view are two renderings of one
 * measurement rather than two measurements that ought to agree.
 */
import { BamFile } from '@gmod/bam'

import { summarizePlan } from '../../src/LaunchTView/repeatStats'
import { planTviewMsa } from '../../src/LaunchTView/tview'

/**
 * Reference bases for a region, from the UCSC API.
 *
 * A locus is only a locus against a sequence, and this is the one source that
 * needs no local files. `chrom` is UCSC's spelling of the reference name, which
 * for the GRCh37 BAMs here is not the BAM's own — hence both being asked for.
 */
export async function referenceSequence({ genome, chrom, start, end }) {
  const res = await fetch(
    `https://api.genome.ucsc.edu/getData/sequence?genome=${genome}&chrom=${chrom}&start=${start}&end=${end}`,
  )
  if (!res.ok) {
    throw new Error(`UCSC sequence ${genome} ${chrom}: ${res.status}`)
  }
  const json = await res.json()
  if (!json.dna) {
    throw new Error(`UCSC sequence ${genome} ${chrom}: ${JSON.stringify(json)}`)
  }
  return json.dna.toUpperCase()
}

/** Every read overlapping the region, in the shape the layout reads them in. */
export async function fetchReads({ uri, refName, start, end }) {
  const bam = new BamFile(
    /^https?:\/\//.test(uri)
      ? { bamUrl: uri, baiUrl: `${uri}.bai` }
      : { bamPath: uri, baiPath: `${uri}.bai` },
  )
  await bam.getHeader()
  // getRecordsForRange answers a reference it has never heard of with no reads
  // at all, which reads downstream as an empty locus rather than as the wrong
  // name. `chr1` against a BAM that calls it `1` is the ordinary way to get
  // here — hence --ref-name existing in the first place — so say which name
  // missed and what the file does call its references.
  if ((await bam.getSeqId(refName)) === undefined) {
    const names = Object.keys(bam.chrToIndex ?? {})
    throw new Error(
      `${uri} has no reference named ${refName}; it has ${names.length} ` +
        `including ${names.slice(0, 5).join(', ')} — pass --ref-name`,
    )
  }
  const records = await bam.getRecordsForRange(refName, start, end)
  return records.filter(r => !!r.seq).map(r => ({ get: key => r[key] }))
}

/**
 * One locus measured across every source: the plan the view would build, and
 * the numbers that fall out of it.
 *
 * `sources` are `{ id, uri }`; the id becomes the row prefix and the clade
 * label, which is what makes the per-sample numbers below separable at all.
 */
export async function measureLocus({ locus, sources, genome }) {
  const sequence = await referenceSequence({ genome, ...locus })
  const perSource = []
  for (const source of sources) {
    perSource.push(await fetchReads({ uri: source.uri, ...locus }))
  }
  const sampleByIndex = perSource.flatMap((reads, i) =>
    reads.map(() => sources[i].id),
  )
  const plan = planTviewMsa({
    features: perSource.flat(),
    refName: locus.refName,
    start: locus.start,
    end: locus.end,
    sequence,
    sampleOf: i => sampleByIndex[i],
  })
  return {
    locus,
    reads: perSource.flat().length,
    ...summarizePlan(
      plan,
      sources.map(s => s.id),
    ),
  }
}

export async function measureLoci({ loci, sources, genome }) {
  const ret = []
  for (const locus of loci) {
    ret.push(await measureLocus({ locus, sources, genome }))
  }
  return ret
}

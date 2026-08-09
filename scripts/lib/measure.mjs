/**
 * Measuring a locus in a set of alignment files, outside the browser.
 *
 * The same plan builder the view runs, over reads fetched straight from the
 * BAMs, so a report and a screenshot of the view are two renderings of one
 * measurement rather than two measurements that ought to agree.
 */
import { BamFile } from '@gmod/bam'
import { BgzipIndexedFasta, IndexedFasta } from '@gmod/indexedfasta'

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

/**
 * The same bases from an indexed FASTA on disk.
 *
 * A FASTA is the reference the BAM was aligned to, so it is the BAM's spelling
 * of a reference name that will be in it — `refName` — where UCSC wants
 * `chrom`. Either is accepted, because a locus written in UCSC's spelling
 * against a FASTA that agrees is the ordinary case and should not need
 * --ref-name to say so twice.
 */
function fastaSequence(uri) {
  const opts = { path: uri, faiPath: `${uri}.fai` }
  const fasta = /\.b?gz$/.test(uri)
    ? new BgzipIndexedFasta({ ...opts, gziPath: `${uri}.gzi` })
    : new IndexedFasta(opts)
  return async ({ chrom, refName, start, end }) => {
    const names = await fasta.getSequenceNames()
    const name = [refName, chrom].find(n => names.includes(n))
    if (name === undefined) {
      throw new Error(
        `${uri} has no sequence named ${refName} or ${chrom}; it has ` +
          `${names.length} including ${names.slice(0, 5).join(', ')}`,
      )
    }
    const seq = await fasta.getSequence(name, start, end)
    if (!seq) {
      throw new Error(`${uri} has no bases at ${name}:${start}-${end}`)
    }
    return seq.toUpperCase()
  }
}

/**
 * Where the reference bases for a locus come from: a local indexed FASTA if one
 * was given, and otherwise the UCSC API, which needs no local files at all.
 */
export function referenceReader({ genome, fasta }) {
  return fasta
    ? fastaSequence(fasta)
    : locus => referenceSequence({ genome, ...locus })
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
export async function measureLocus({ locus, sources, sequenceOf }) {
  const sequence = await sequenceOf(locus)
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

export async function measureLoci({ loci, sources, genome, fasta }) {
  const sequenceOf = referenceReader({ genome, fasta })
  const ret = []
  for (const locus of loci) {
    ret.push(await measureLocus({ locus, sources, sequenceOf }))
  }
  return ret
}

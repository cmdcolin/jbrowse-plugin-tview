import { describe, expect, it } from 'vitest'

import {
  alleleModes,
  summarizePlan,
  tally,
} from '../src/LaunchTView/repeatStats'
import { planTviewMsa } from '../src/LaunchTView/tview'

import type { AlignmentFeature } from '../src/LaunchTView/tview'

/** `n` reads at each of the given copy counts */
function reads(...groups: [copies: number, n: number][]) {
  return groups.flatMap(([copies, n]) =>
    Array.from({ length: n }, () => copies),
  )
}

const values = (ts: { value: number }[]) => ts.map(t => t.value)

describe('tally', () => {
  it('counts each distinct value, smallest first', () => {
    expect(tally([3, 1, 3, 2, 3])).toEqual([
      { value: 1, reads: 1 },
      { value: 2, reads: 1 },
      { value: 3, reads: 3 },
    ])
  })
})

describe('alleleModes', () => {
  it('counts a shoulder into the allele it belongs to', () => {
    // the reads either side of an allele are its own: slippage in the molecule
    // and in the aligner, not a second allele two reads wide
    const [allele, ...rest] = alleleModes(reads([30, 2], [31, 36], [32, 3]))
    expect(rest).toEqual([])
    expect(allele).toEqual({ value: 31, reads: 41 })
  })

  it('keeps two alleles a single copy apart', () => {
    // FMR1's mother. Both are real and neither is the other's shoulder, which
    // no distance between them can say and their relative support can
    expect(values(alleleModes(reads([32, 30], [33, 26])))).toEqual([32, 33])
  })

  it('separates two alleles that a proportional bandwidth would reach across', () => {
    // ATXN3's father, 15 and 17 with the skirt of the stronger one between
    expect(values(alleleModes(reads([15, 14], [16, 7], [17, 33])))).toEqual([
      15, 17,
    ])
  })

  it('widens the skirt for a larger allele', () => {
    // 89 copies scatter further than 8 do, so a read 5 copies out belongs to
    // the large allele where the same distance would not to a small one
    expect(values(alleleModes(reads([84, 2], [89, 30])))).toEqual([89])
    expect(values(alleleModes(reads([3, 6], [8, 30])))).toEqual([3, 8])
  })

  it('reports nothing when no count carries enough of the coverage', () => {
    expect(alleleModes(reads([10, 1], [20, 1], [30, 1], [40, 1]))).toEqual([])
  })

  it('never calls an allele on one read', () => {
    expect(alleleModes([7])).toEqual([])
  })
})

describe('summarizePlan', () => {
  const FLANK = 'TTGCAGGATC'
  const sequence = `${FLANK}${'CAG'.repeat(10)}${FLANK}`
  const sample = 'HG004 (mother)'

  /** four reads carrying the reference allele, all from one sample */
  function planForSample() {
    const features: AlignmentFeature[] = [0, 1, 2, 3].map(i => {
      const f: Record<string, unknown> = {
        name: `read${i}`,
        start: 0,
        CIGAR: `${sequence.length}M`,
        seq: sequence,
        flags: 0,
      }
      return { get: (key: string) => f[key] }
    })
    return planTviewMsa({
      features,
      refName: 'chr1',
      start: 0,
      end: sequence.length,
      sequence,
      sampleOf: () => sample,
    })
  }

  it('finds a sample whose name Newick-sanitizing rewrote', () => {
    // rows are prefixed with the safe form, so matching on the name as given
    // found none of them — and nought spanning reads is what an unsequenced
    // locus looks like, not what a track called `HG004 (mother)` should
    const [array] = summarizePlan(planForSample(), [sample]).arrays
    expect(array!.samples[0]).toMatchObject({
      sample,
      spanning: 4,
      modes: [{ value: 10, reads: 4 }],
    })
  })
})

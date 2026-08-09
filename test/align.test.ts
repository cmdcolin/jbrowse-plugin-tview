import { describe, expect, it } from 'vitest'

import {
  alignInsertions,
  alignPeriodicInsertions,
  consensusUnit,
  detectPeriod,
  unitIdentity,
} from '../src/LaunchTView/align'

function widths(result: Map<string, string>) {
  return new Set([...result.values()].map(s => s.length))
}

// a 30bp VNTR-like unit
const UNIT = 'CCTCCTGGGTTCAAGCGATTCTCCTGCCTC'

describe('alignInsertions', () => {
  it('declines when there is nothing to align', () => {
    expect(alignInsertions([]).size).toBe(0)
    expect(alignInsertions(['ACGT', 'ACGT']).size).toBe(0)
  })

  it('gaps a sequence missing a base in the middle of a shared event', () => {
    expect(
      Object.fromEntries(alignInsertions(['ACGTACGT', 'ACGACGT'])),
    ).toEqual({
      ACGTACGT: 'ACGTACGT',
      ACGACGT: 'ACG-ACGT',
    })
  })

  it('widens every sequence to the longest, gapping the shorter ones', () => {
    // where an equally-scoring gap lands is arbitrary; the traceback puts it
    // as far right as it can, consistently across the site
    const result = alignInsertions(['ACGT', 'ACGTT', 'ACGA'])
    expect(Object.fromEntries(result)).toEqual({
      ACGT: 'ACG-T',
      ACGTT: 'ACGTT',
      ACGA: 'ACG-A',
    })
  })

  it('keeps every sequence the same length', () => {
    const result = alignInsertions(['AAGGTTCC', 'AAGTTCC', 'AAGGTTTCC', 'AA'])
    expect(widths(result).size).toBe(1)
  })

  it('preserves each sequence once gaps are removed', () => {
    const seqs = ['AAGGTTCC', 'AAGTTCC', 'AAGGTTTCC', 'AA']
    for (const [raw, gapped] of alignInsertions(seqs)) {
      expect(gapped.replaceAll('-', '')).toBe(raw)
    }
  })

  it('declines sites too large to be worth aligning', () => {
    const long = 'A'.repeat(201)
    expect(alignInsertions([long, `${long}A`]).size).toBe(0)
    expect(
      alignInsertions(Array.from({ length: 31 }, (_, i) => 'A'.repeat(i + 1)))
        .size,
    ).toBe(0)
  })

  it('lays a tandem array out unit-per-block, past both size caps', () => {
    // 450bp and 600bp are both over MAX_LEN, and the aperiodic path declines
    // them; the array is the case that layout exists for
    const result = alignInsertions([UNIT.repeat(15), UNIT.repeat(20)])
    expect(result.size).toBe(2)
    expect(widths(result).size).toBe(1)
  })
})

describe('detectPeriod', () => {
  it('finds the unit length of a tandem array', () => {
    expect(detectPeriod(UNIT.repeat(12))).toBe(30)
  })

  it('reports the minimal period, not a multiple of it', () => {
    expect(detectPeriod('CAG'.repeat(40))).toBe(3)
  })

  it('reports 1 for a homopolymer, which is what declines it', () => {
    expect(detectPeriod('A'.repeat(201))).toBe(1)
  })

  it('declines a sequence that does not repeat', () => {
    expect(detectPeriod('ACGTTGCAAGGCTTACGATCCGATTACAGGC')).toBeUndefined()
  })

  it('declines below three copies, where the period is unidentifiable', () => {
    expect(detectPeriod(UNIT.repeat(2))).toBeUndefined()
  })

  it('tolerates divergence between copies', () => {
    // one substitution in every copy, ~3% divergence
    const diverged = Array.from(
      { length: 12 },
      (_, i) => `${UNIT.slice(0, 7)}${'ACGT'[i % 4]}${UNIT.slice(8)}`,
    ).join('')
    expect(detectPeriod(diverged)).toBe(30)
  })
})

describe('consensusUnit', () => {
  it('takes the majority base at each offset', () => {
    // copy 1 differs at offset 0; the other two carry the majority
    expect(consensusUnit('TCGACGACGA', 3)).toBe('ACG')
  })
})

describe('alignPeriodicInsertions', () => {
  const alleles = [UNIT.repeat(12), UNIT.repeat(13), UNIT.repeat(20)]

  it('reports the period and each allele copy count', () => {
    const result = alignPeriodicInsertions(alleles)!
    expect(result.period).toBe(30)
    expect([...result.copies.values()]).toEqual([12, 13, 20])
  })

  it('keeps every row the same length', () => {
    const { gapped } = alignPeriodicInsertions(alleles)!
    expect(widths(gapped).size).toBe(1)
  })

  it('preserves each sequence once gaps are removed', () => {
    const { gapped } = alignPeriodicInsertions(alleles)!
    for (const [raw, row] of gapped) {
      expect(row.replaceAll('-', '')).toBe(raw)
    }
  })

  it('runs each allele out of blocks at its own copy count', () => {
    // the point of the layout: a 12-copy allele is all-gap from block 13 on,
    // so copy number is a count of blocks rather than a row length
    const { gapped, unitWidths } = alignPeriodicInsertions(alleles)!
    const blockStart = (k: number) =>
      unitWidths.slice(0, k).reduce((a, b) => a + b, 0)
    const row12 = gapped.get(UNIT.repeat(12))!
    expect(row12.slice(0, blockStart(12))).not.toContain('-')
    expect(row12.slice(blockStart(12)).replaceAll('-', '')).toBe('')
  })

  it('puts a divergent copy in one column rather than shifting the rest', () => {
    // copy 3 of one allele carries a substitution; every later copy must stay
    // in register, which is what base-to-base alignment cannot promise
    const mutated =
      UNIT.repeat(2) + UNIT.slice(0, 10) + 'A' + UNIT.slice(11) + UNIT.repeat(9)
    const { gapped, copies, period } = alignPeriodicInsertions([
      UNIT.repeat(12),
      mutated,
    ])!
    expect(copies.get(mutated)).toBe(12)
    const a = gapped.get(UNIT.repeat(12))!
    const b = gapped.get(mutated)!
    let differing = 0
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        differing++
      }
    }
    expect(differing).toBe(1)
    expect(a.length).toBe(12 * period)
  })

  it('declines a homopolymer', () => {
    expect(
      alignPeriodicInsertions(['A'.repeat(201), 'A'.repeat(180)]),
    ).toBeUndefined()
  })

  it('declines an aperiodic insertion', () => {
    expect(
      alignPeriodicInsertions([
        'ACGTTGCAAGGCTTACGATCCGATTACAGGC',
        'ACGTTGCAAGGCTTACGATCCGATTACAGG',
      ]),
    ).toBeUndefined()
  })
})

describe('unitIdentity', () => {
  it('scores a clean run of copies at 1', () => {
    expect(unitIdentity('CTG'.repeat(13), 'CTG')).toBe(1)
  })

  it('scores a run that starts mid-copy at 1', () => {
    // the aligner anchors an insertion where it likes, so an inserted run of
    // copies routinely starts out of phase with the reference's own first copy
    expect(unitIdentity(`G${'CTG'.repeat(12)}CT`, 'CTG')).toBe(1)
  })

  it('scores the FMR1 allele the aligner placed outside the array', () => {
    // 32bp of CGG carrying the locus's own AGG interruptions, anchored 2bp
    // before the array; the number to beat is what unrelated sequence scores
    expect(
      unitIdentity('CGCGCGGCGGCGGCGGCGGCGGCGCGGAGGCG', 'GCG'),
    ).toBeGreaterThan(0.9)
  })

  it('scores a VNTR run whose copies vary in length', () => {
    const unit = 'CCCCCCACCACTCCCTCCCCGTGAG'
    const ins =
      'CCCCGTGAGCTGCCCCCACCACTCCCTCCCTGTGAGCCCCCCACCACTCCCTCCCCGTGAGCTGCCCCCACCACTCCCTCCCTGTGAGCCCCCCACCACTCCCTCCC'
    expect(unitIdentity(ins, unit)).toBeGreaterThan(0.9)
  })

  it('declines sequence that is not the unit', () => {
    // an Alu head, random sequence, and a neighbouring trinucleotide repeat:
    // the closest of the three still leaves room under the 0.8 the caller uses
    expect(
      unitIdentity('GGCCGGGCGCGGTGGCTCACGCCTGTAATCCCAGCA', 'GCG'),
    ).toBeLessThan(0.7)
    expect(
      unitIdentity('TACGATCGTAGCTAGCATCGATCGGATCCTAGCATG', 'CTG'),
    ).toBeLessThan(0.7)
    expect(unitIdentity('CAG'.repeat(11), 'CTG')).toBeLessThan(0.7)
  })

  it('declines an empty sequence or an empty unit', () => {
    expect(unitIdentity('', 'CTG')).toBe(0)
    expect(unitIdentity('CTGCTG', '')).toBe(0)
  })
})

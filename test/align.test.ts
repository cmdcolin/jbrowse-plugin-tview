import { describe, expect, it } from 'vitest'

import {
  alignInsertionSite,
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

function random(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomSeq(rand: () => number, length: number) {
  return Array.from({ length }, () => 'ACGT'[Math.floor(rand() * 4)]).join('')
}

/** `seq` with substitutions, deletions and insertions at `rate` between them */
function noisy(rand: () => number, seq: string, rate: number) {
  let ret = ''
  for (const base of seq) {
    const r = rand() / rate
    ret +=
      r < 0.4
        ? randomSeq(rand, 1)
        : r < 0.7
          ? ''
          : r < 1
            ? base + randomSeq(rand, 1)
            : base
  }
  return ret
}

/** the first row's character in every column where the two rows differ */
function differing(a: string, b: string) {
  let ret = ''
  for (let i = 0; i < a.length; i++) {
    ret += a[i] === b[i] ? '' : a[i]
  }
  return ret
}

/** columns where both rows carry a base and the bases differ */
function mismatches(a: string, b: string) {
  let ret = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== '-' && b[i] !== '-' && a[i] !== b[i]) {
      ret++
    }
  }
  return ret
}

/** the textbook full-matrix global alignment, gaps placed as far right as they go */
function needlemanWunsch(a: string, b: string) {
  const score = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => -3 * (i + j)),
  )
  const step = (i: number, j: number) =>
    score[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 2 : -2)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      score[i]![j] = Math.max(
        step(i, j),
        score[i - 1]![j]! - 3,
        score[i]![j - 1]! - 3,
      )
    }
  }
  let center = ''
  let other = ''
  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && score[i]![j] === step(i, j)) {
      center = a[--i]! + center
      other = b[--j]! + other
    } else if (i > 0 && score[i]![j] === score[i - 1]![j]! - 3) {
      center = a[--i]! + center
      other = `-${other}`
    } else {
      center = `-${center}`
      other = b[--j]! + other
    }
  }
  return { center, other }
}

function alignInsertions(seqs: string[]) {
  return alignInsertionSite(seqs).gapped
}

describe('alignInsertionSite', () => {
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

  it('aligns a 250bp insertion whose copies differ by one deleted base', () => {
    const ins = randomSeq(random(1), 250)
    const shorter = ins.slice(0, 120) + ins.slice(121)
    const result = alignInsertions([ins, shorter])
    expect(mismatches(result.get(ins)!, result.get(shorter)!)).toBe(0)
    expect(result.get(shorter)!.replaceAll('-', '')).toBe(shorter)
  })

  it('aligns a pair of 6kb insertions differing by a handful of indels quickly', () => {
    const rand = random(2)
    const ins = randomSeq(rand, 6000)
    const edited =
      ins.slice(0, 1000) +
      ins.slice(1003, 2500) +
      'GATTACA' +
      ins.slice(2500, 4000) +
      ins.slice(4001, 5200) +
      'TT' +
      ins.slice(5200)
    const t0 = performance.now()
    const result = alignInsertions([ins, edited])
    expect(performance.now() - t0).toBeLessThan(500)
    expect(result.size).toBe(2)
    expect(mismatches(result.get(ins)!, result.get(edited)!)).toBe(0)
  })

  it('aligns 300 reads of a noisy 300bp insertion', () => {
    const rand = random(3)
    const ins = randomSeq(rand, 300)
    const reads = Array.from({ length: 300 }, () => noisy(rand, ins, 0.1))
    const result = alignInsertions(reads)
    expect(result.size).toBe(new Set(reads).size)
    expect(widths(result).size).toBe(1)
    for (const [raw, gapped] of result) {
      expect(gapped.replaceAll('-', '')).toBe(raw)
    }
  })

  it('declines a site whose alignment would exceed the budget', () => {
    const rand = random(4)
    const result = alignInsertions([
      randomSeq(rand, 10_000),
      randomSeq(rand, 10_000),
    ])
    expect(result.size).toBe(0)
  })

  it('finds the same alignment the full matrix does', () => {
    const rand = random(5)
    for (let trial = 0; trial < 40; trial++) {
      const center = randomSeq(rand, 20 + Math.floor(rand() * 200))
      const other = noisy(rand, center, rand() * 0.5)
      const result = alignInsertions([center, center, other])
      const expected = needlemanWunsch(center, other)
      expect(result.get(center)).toBe(expected.center)
      expect(result.get(other)).toBe(expected.other)
    }
  })

  it('aligns against the commonest sequence, not the longest', () => {
    // with the chimeric read as the center, the two real alleles would each
    // be aligned against unrelated sequence and drift apart from each other
    const rand = random(6)
    const allele = randomSeq(rand, 60)
    const variant = allele.slice(0, 30) + allele.slice(31)
    const chimera = allele.slice(0, 20) + randomSeq(rand, 80)
    const result = alignInsertions([allele, allele, allele, variant, chimera])
    const a = result.get(allele)!
    const b = result.get(variant)!
    expect(differing(a, b)).toBe(allele[30])
  })

  it('lays a site out the same whatever order its reads arrive in', () => {
    const rand = random(7)
    const ins = randomSeq(rand, 80)
    const reads = Array.from({ length: 12 }, () => noisy(rand, ins, 0.1))
    const forward = alignInsertions(reads)
    const backward = alignInsertions([...reads].reverse())
    expect(Object.fromEntries(backward)).toEqual(Object.fromEntries(forward))
  })

  it('lays a tandem array out unit-per-block', () => {
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
    // copies routinely starts out of phase with the reference own first copy
    expect(unitIdentity(`G${'CTG'.repeat(12)}CT`, 'CTG')).toBe(1)
  })

  it('scores the FMR1 allele the aligner placed outside the array', () => {
    // 32bp of CGG carrying the locus own AGG interruptions, anchored 2bp
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

  it('declines a run of copies with a kilobase of something else after it', () => {
    // the reason three windows are scored rather than a prefix: this is the
    // shape of a chimeric read, and scoring only the head calls it 1.00
    const junk = 'TACGATCGTAGCTAGCATCGATCGGATCCTAGCATG'.repeat(28)
    expect(unitIdentity('CTG'.repeat(12), 'CTG')).toBe(1)
    expect(unitIdentity('CTG'.repeat(12) + junk, 'CTG')).toBeLessThan(0.7)
  })

  it('declines an empty sequence or an empty unit', () => {
    expect(unitIdentity('', 'CTG')).toBe(0)
    expect(unitIdentity('CTGCTG', '')).toBe(0)
  })
})

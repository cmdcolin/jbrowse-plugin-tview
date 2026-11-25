import { describe, expect, it } from 'vitest'

import {
  buildArrayBlocks,
  extractAllele,
  mergeInsertionSites,
  moveInsertion,
  normalizeInsertions,
  reanchorInsertions,
  shiftInsertion,
} from '../src/LaunchTView/alleles'

import type { ReadLayout } from '../src/LaunchTView/readLayout'
import type { ReferenceArray } from '../src/LaunchTView/repeats'

const FILLER = 'ACTGGATCCATGCTAGGTCAAGTCTGACTTGCAAGGATCCTAGGTCAATGCAAGTTCGGATC'

/** an array of 10 CTG copies at reference position 1000 */
const ARRAY: ReferenceArray = {
  start: 1000,
  end: 1030,
  period: 3,
  unit: 'CTG',
}

/**
 * A read spanning 900..1100 that matches the reference everywhere, carrying
 * `insertions` on top.
 *
 * The array runs on for a copy either side of the interval, which is what a
 * real locus looks like: the reference scan cuts an array back to where it
 * scored best, so the lead-in and run-out are degenerate copy rather than
 * unrelated sequence. It is also what gives an insertion room to move — the
 * rewrite is exact, so an in-phase run of copies reaches the array and anything
 * else stops where the read's own bases stop agreeing.
 */
function read(name: string, insertions: [number, string][] = []): ReadLayout {
  const refChars =
    FILLER.repeat(2).slice(0, 97) +
    'CTG'.repeat(13) +
    FILLER.repeat(2).slice(0, 70)
  return {
    name,
    start: 900,
    refChars,
    insertions: new Map(insertions),
  }
}

/** where each of a read's insertions ended up, after re-anchoring */
function anchored(read: ReadLayout, arrays = [ARRAY]) {
  return [...reanchorInsertions([read], arrays)[0]!.insertions]
}

describe('shiftInsertion', () => {
  it('rotates a run of copies rightward onto the array edge', () => {
    // 997..999 are CTG, so an in-phase run walks the three bases into the
    // array and comes back in phase with it
    expect(shiftInsertion(read('a'), 997, 1000, 'CTG'.repeat(7))).toBe(
      'CTG'.repeat(7),
    )
  })

  it('rotates leftward the same way', () => {
    expect(shiftInsertion(read('a'), 1003, 1000, 'CTG'.repeat(7))).toBe(
      'CTG'.repeat(7),
    )
  })

  it('declines a step the read has no matching base for', () => {
    // an Alu head next to the array: it cannot rotate through CTG, so it is
    // not the array's however close it was anchored. No identity score is
    // consulted to reach that — the read's own bases settle it
    expect(
      shiftInsertion(read('a'), 997, 1000, 'GGCCGGGCGCGGTGGCTCACGCCTG'),
    ).toBeUndefined()
  })

  it('declines a step onto a deletion', () => {
    const deleted: ReadLayout = {
      name: 'd',
      start: 995,
      refChars: `CT-${'CTG'.repeat(11)}`,
      insertions: new Map(),
    }
    // there is no base to swap the insertion with, so the placement stands
    expect(shiftInsertion(deleted, 997, 1000, 'CTG'.repeat(7))).toBeUndefined()
  })
})

describe('reanchorInsertions', () => {
  it('leaves a read alone when nothing is anchored beside the array', () => {
    const plain = read('a')
    expect(reanchorInsertions([plain], [ARRAY])[0]).toBe(plain)
  })

  it('re-files a run of copies anchored just before the array', () => {
    expect(anchored(read('a', [[997, 'CTG'.repeat(7)]]))).toEqual([
      [1000, 'CTG'.repeat(7)],
    ])
  })

  it('re-files one anchored just after the array', () => {
    // the slot at `end` is the one extractAllele reads, so that is where an
    // insertion arriving from the right lands
    expect(anchored(read('a', [[1033, 'CTG'.repeat(7)]]))).toEqual([
      [1030, 'CTG'.repeat(7)],
    ])
  })

  it('leaves an insertion beyond the flank where it is', () => {
    // 25bp is the buffer adotto measured as enough; past it a placement is a
    // placement rather than the aligner's slack
    expect(anchored(read('a', [[970, 'CTG'.repeat(7)]]))).toEqual([
      [970, 'CTG'.repeat(7)],
    ])
  })

  it('leaves sequence that is not the array own where it is', () => {
    const alu = 'GGCCGGGCGCGGTGGCTCACGCCTGTAATCCCAGCA'
    expect(anchored(read('a', [[997, alu]]))).toEqual([[997, alu]])
  })

  it('moves the array own sequence even when no rewrite of it exists', () => {
    // FMR1's shape: an aligner picks the highest-scoring placement, not an
    // equivalent one, so a real repeat allele routinely cannot be rotated into
    // the array it belongs to. Its bases move as written, which is what keeps
    // the length the measurement is made of
    const outOfPhase = 'TGC'.repeat(7)
    expect(anchored(read('a', [[997, outOfPhase]]))).toEqual([
      [1000, outOfPhase],
    ])
  })

  it('leaves a fragment shorter than one copy where it is', () => {
    // a base or two of read error beside an array says nothing about where its
    // allele ends, and the identity of a fragment that short measures nothing
    expect(anchored(read('a', [[997, 'CT']]))).toEqual([[997, 'CT']])
  })

  it('moves each read on its own', () => {
    // the property the shared widened interval could not have: one read's
    // misplacement stays that read's, and every other row is untouched
    const clean = read('ref')
    const [movedRef, movedRead] = reanchorInsertions(
      [clean, read('expanded', [[997, 'CTG'.repeat(7)]])],
      [ARRAY],
    )
    expect(movedRef).toBe(clean)
    expect([...movedRead!.insertions.keys()]).toEqual([1000])
  })

  it('will not let two arrays claim one slot', () => {
    // a shared position would be counted into both alleles, since the slot at
    // an array's `end` is one it reads
    const neighbour: ReferenceArray = {
      start: 1032,
      end: 1080,
      period: 3,
      unit: 'CTG',
    }
    const both = [ARRAY, neighbour]
    expect(anchored(read('a', [[1031, 'TGC'.repeat(7)]]), both)).toEqual([
      [1030, 'CTG'.repeat(7)],
    ])
    expect(anchored(read('b', [[1032, 'CTG'.repeat(7)]]), both)).toEqual([
      [1032, 'CTG'.repeat(7)],
    ])
  })

  it('keeps two events landing in one slot in read order', () => {
    const [[pos, seq]] = anchored(
      read('a', [
        [997, 'CTG'.repeat(2)],
        [999, 'GCT'.repeat(3)],
      ]),
    )
    expect(pos).toBe(1000)
    expect(seq).toBe('CTG'.repeat(2) + 'CTG'.repeat(3))
  })

  it('counts the re-anchored copies into the allele, and only that read', () => {
    // the measurement this exists for: unanchored, a read whose expansion the
    // aligner placed outside the array is measured as the reference allele and
    // its bases become a column block of their own
    const reads = [read('ref'), read('expanded', [[997, 'CTG'.repeat(7)]])]
    const before = buildArrayBlocks(reads, [ARRAY])[0]!
    expect(before.copiesByName.get('expanded')).toBe(10)

    const after = buildArrayBlocks(reanchorInsertions(reads, [ARRAY]), [
      ARRAY,
    ])[0]!
    expect(after.copiesByName.get('expanded')).toBe(17)
    // and the interval did not move, so no other row paid for it — which is
    // what keeps a reference copy count from drifting with the reads
    expect(after.copiesByName.get('ref')).toBe(before.copiesByName.get('ref')!)
    expect(after.lengthByName.get('ref')).toBe(before.lengthByName.get('ref')!)
  })
})

describe('extractAllele', () => {
  it('declines a read that does not reach both edges', () => {
    const partial: ReadLayout = {
      name: 'p',
      start: 1010,
      refChars: 'CTG'.repeat(10),
      insertions: new Map(),
    }
    expect(extractAllele(partial, 1000, 1030)).toBeUndefined()
  })

  it('adds what a read inserted inside the interval', () => {
    const r = read('a', [[1012, 'CTGCTG']])
    expect(extractAllele(r, 1000, 1030)!.length).toBe(36)
  })
})

/** the read's bases in read order, which no re-filing of its insertions may change */
function spell(read: ReadLayout) {
  let ret = ''
  for (let i = 0; i <= read.refChars.length; i++) {
    ret += read.insertions.get(read.start + i) ?? ''
    ret += /[ACGTN]/.test(read.refChars[i] ?? '') ? read.refChars[i] : ''
  }
  return ret
}

function normalized(read: ReadLayout, arrays: ReferenceArray[] = [], from = 0) {
  return normalizeInsertions([read], arrays, from)[0]!
}

describe('normalizeInsertions', () => {
  const plain = (
    insertions: [number, string][],
    refChars = 'TTTTCACACAGGGG',
  ) => ({
    name: 'a',
    start: 0,
    refChars,
    insertions: new Map(insertions),
  })

  it('walks an insertion to the leftmost placement that spells the same read', () => {
    const read = plain([[10, 'CA']])
    const result = normalized(read)
    expect([...result.insertions]).toEqual([[4, 'CA']])
    expect(spell(result)).toBe(spell(read))
  })

  it('leaves a read alone when nothing can move', () => {
    const read = plain([[4, 'CA']])
    expect(normalized(read)).toBe(read)
  })

  it('stops at a deletion', () => {
    const read = plain([[10, 'CA']], 'TTTTCA-ACAGGGG')
    const result = normalized(read)
    expect([...result.insertions]).toEqual([[7, 'AC']])
    expect(spell(result)).toBe(spell(read))
  })

  it('stops at the read own start', () => {
    const read = { ...plain([[11, 'CA']], 'CACACAGGGG'), start: 5 }
    expect([...normalized(read).insertions]).toEqual([[5, 'CA']])
  })

  it('stops one base inside the region, so the site has a base either side', () => {
    const read = plain([[10, 'CA']])
    expect([...normalized(read, [], 7).insertions]).toEqual([[8, 'CA']])
  })

  it('keeps two insertions that meet in read order', () => {
    const read = plain([
      [4, 'GG'],
      [10, 'CA'],
    ])
    const result = normalized(read)
    expect([...result.insertions]).toEqual([[4, 'GGCA']])
    expect(spell(result)).toBe(spell(read))
  })

  // the array's copies run on 40 copies past its interval, so an insertion
  // beyond the flank walks back through them toward it
  const longRun: ReadLayout = {
    name: 'run',
    start: 900,
    refChars: FILLER.repeat(2).slice(0, 100) + 'CTG'.repeat(40) + FILLER,
    insertions: new Map(),
  }

  it('stops one past an array end, never inside it', () => {
    const read = { ...longRun, insertions: new Map([[1081, 'CTG']]) }
    const result = normalized(read, [ARRAY])
    expect([...result.insertions.keys()]).toEqual([ARRAY.end + 1])
    expect(spell(result)).toBe(spell(read))
  })

  it('leaves an insertion the array owns where it is', () => {
    const read = {
      ...longRun,
      insertions: new Map([
        [1012, 'CTG'],
        [ARRAY.end, 'CTG'],
      ]),
    }
    expect(normalized(read, [ARRAY])).toBe(read)
  })

  it('leaves every copy count and allele length as re-anchoring left it', () => {
    const reads = [
      read('ref'),
      read('inside', [[1012, 'CTGCTG']]),
      read('early', [[997, 'CTG'.repeat(7)]]),
      read('late', [[1033, 'CTG'.repeat(4)]]),
      read('beyond', [[1070, 'GGATCC']]),
      { ...longRun, name: 'run', insertions: new Map([[1081, 'CTG']]) },
    ]
    const anchored = reanchorInsertions(reads, [ARRAY])
    const normal = normalizeInsertions(anchored, [ARRAY], 900)
    expect(normal.filter((r, i) => r !== anchored[i]).map(r => r.name)).toEqual(
      ['run'],
    )
    const before = buildArrayBlocks(anchored, [ARRAY])[0]!
    const after = buildArrayBlocks(normal, [ARRAY])[0]!
    expect(Object.fromEntries(after.copiesByName)).toEqual(
      Object.fromEntries(before.copiesByName),
    )
    expect(Object.fromEntries(after.lengthByName)).toEqual(
      Object.fromEntries(before.lengthByName),
    )
    expect(Object.fromEntries(after.rowByName)).toEqual(
      Object.fromEntries(before.rowByName),
    )
  })
})

describe('moveInsertion', () => {
  const read: ReadLayout = {
    name: 'a',
    start: 0,
    refChars: 'ACGTACGT',
    insertions: new Map([[4, 'GG']]),
  }

  it('re-divides the read bases, whatever the reference says', () => {
    expect(moveInsertion(read, 4, 6, 'GG')).toEqual({
      seq: 'AC',
      refChars: 'ACGTGGGT',
    })
    expect(moveInsertion(read, 4, 2, 'GG')).toEqual({
      seq: 'GT',
      refChars: 'ACGGACGT',
    })
  })

  it('declines to pass a position the read has no base at', () => {
    expect(
      moveInsertion({ ...read, refChars: 'ACGTA-GT' }, 4, 6, 'GG'),
    ).toBeUndefined()
  })

  it('declines a target past either end of the read', () => {
    expect(moveInsertion(read, 4, 9, 'GG')).toBeUndefined()
    expect(moveInsertion({ ...read, start: 2 }, 4, 1, 'GG')).toBeUndefined()
  })
})

describe('mergeInsertionSites', () => {
  const REF = 'ACGTTGCATCGGATCCTAGAAAGTCGTACGGTTACAGCTA'
  const ALU = 'GGCCGGGCGCGGTGGCTCACGCCTGTAATC'
  const reference = { seq: REF, start: 0 }
  const carrier = (
    name: string,
    insertions: [number, string][],
    refChars = REF,
  ): ReadLayout => ({
    name,
    start: 0,
    refChars,
    insertions: new Map(insertions),
  })
  const majority = ['a', 'b', 'c'].map(name => carrier(name, [[20, ALU]]))
  const merged = (read: ReadLayout, arrays: ReferenceArray[] = []) =>
    mergeInsertionSites([...majority, read], arrays, reference).at(-1)!

  // the NPHP4 Alu's shape: the read carries an extra base before the copy, so
  // the aligner anchored the copy one base early, and the base it aligned at
  // 19 is the copy's last
  const early = carrier(
    'early',
    [[19, `T${ALU.slice(0, -1)}`]],
    `${REF.slice(0, 19)}${ALU.at(-1)}${REF.slice(20)}`,
  )

  it('is a case no exact rewrite reaches', () => {
    expect(
      shiftInsertion(early, 19, 20, `T${ALU.slice(0, -1)}`),
    ).toBeUndefined()
  })

  it('moves a read anchored one base early to the site most reads use', () => {
    const result = merged(early)
    expect([...result.insertions]).toEqual([[20, ALU]])
    expect(result.refChars[19]).toBe('T')
    expect(spell(result)).toBe(spell(early))
  })

  it('leaves the reads already at that site as they were', () => {
    const result = mergeInsertionSites([...majority, early], [], reference)
    result.slice(0, 3).forEach((read, i) => {
      expect(read).toBe(majority[i])
    })
  })

  it('moves the right of two sites one read each to the left', () => {
    const left = carrier('left', [[20, ALU]])
    const right = carrier('right', [[21, `${ALU.slice(1)}A`]])
    const [a, b] = mergeInsertionSites([right, left], [], reference)
    expect([...a!.insertions.keys()]).toEqual([20])
    expect(spell(a!)).toBe(spell(right))
    expect(b).toBe(left)
  })

  it('leaves a nearby insertion of a different length at its own site', () => {
    const short = carrier('short', [[19, `T${ALU.slice(0, 12)}`]])
    expect(merged(short)).toBe(short)
  })

  it('leaves a read whose move would cost more than a mismatch or two', () => {
    // six bases on, where the copy's tail and the flank share nothing
    const far = carrier('far', [[26, ALU]])
    expect(merged(far)).toBe(far)
  })

  it('never drags a 1bp insertion', () => {
    const errors = ['a', 'b', 'c'].map(name => carrier(name, [[20, 'G']]))
    const stray = carrier('stray', [[19, 'G']])
    expect(mergeInsertionSites([...errors, stray], [], reference)[3]).toBe(
      stray,
    )
  })

  it('leaves an insertion an array owns where it is', () => {
    const array = { start: 10, end: 19, period: 3, unit: 'CAG' }
    expect(merged(early, [array])).toBe(early)
  })

  it('moves nothing across an array', () => {
    const array = { start: 21, end: 23, period: 1, unit: 'A' }
    const beyond = carrier('beyond', [[24, ALU]])
    expect(merged(beyond, [array])).toBe(beyond)
  })

  it('moves nothing across a deletion in the read', () => {
    const gapped = {
      ...early,
      refChars: `${REF.slice(0, 19)}-${REF.slice(20)}`,
    }
    expect(merged(gapped)).toBe(gapped)
  })

  it('moves nothing past another insertion of the same read', () => {
    const twice = carrier('twice', [
      [19, `T${ALU.slice(0, -1)}`],
      [20, 'G'],
    ])
    expect(merged(twice)).toBe(twice)
  })

  it('keeps an insertion in view a base inside the region', () => {
    const fromTwenty = { seq: REF.slice(20), start: 20 }
    expect(
      mergeInsertionSites([...majority, early], [], fromTwenty).at(-1),
    ).toBe(early)
  })
})

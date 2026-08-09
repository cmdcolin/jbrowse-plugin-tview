import { describe, expect, it } from 'vitest'

import {
  buildArrayBlocks,
  extractAllele,
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
    expect(after.copiesByName.get('ref')).toBe(
      before.copiesByName.get('ref')!,
    )
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

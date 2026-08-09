import { describe, expect, it } from 'vitest'

import {
  absorbAdjacentInsertions,
  buildArrayBlocks,
  extractAllele,
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
 */
function read(name: string, insertions: [number, string][] = []): ReadLayout {
  const refChars =
    FILLER.repeat(2).slice(0, 100) +
    'CTG'.repeat(10) +
    FILLER.repeat(2).slice(0, 70)
  return {
    name,
    start: 900,
    refChars,
    insertions: new Map(insertions),
  }
}

describe('absorbAdjacentInsertions', () => {
  it('leaves an array alone when nothing is anchored beside it', () => {
    expect(absorbAdjacentInsertions([read('a')], [ARRAY])).toEqual([ARRAY])
  })

  it('widens over a run of copies anchored just before the array', () => {
    const [widened] = absorbAdjacentInsertions(
      [read('a', [[999, 'CTG'.repeat(7)]])],
      [ARRAY],
    )
    expect(widened!.start).toBe(999)
    expect(widened!.end).toBe(1030)
  })

  it('widens over a run of copies anchored just after the array', () => {
    const [widened] = absorbAdjacentInsertions(
      [read('a', [[1032, 'CTG'.repeat(7)]])],
      [ARRAY],
    )
    expect(widened!.start).toBe(1000)
    // the slot at `end` is the one extractAllele reads, so covering an
    // insertion at 1032 means reaching 1032
    expect(widened!.end).toBe(1032)
  })

  it('declines an insertion further than one copy from the edge', () => {
    // one unit is the aligner's room to move a repeat indel; past that the
    // flanking sequence stops matching and the placement is a real one
    expect(
      absorbAdjacentInsertions(
        [read('a', [[996, 'CTG'.repeat(7)]])],
        [ARRAY],
      )[0],
    ).toEqual(ARRAY)
  })

  it('declines sequence that is not made of the unit', () => {
    expect(
      absorbAdjacentInsertions(
        [read('a', [[999, 'GGCCGGGCGCGGTGGCTCACGCCTGTAATCCCAGCA']])],
        [ARRAY],
      )[0],
    ).toEqual(ARRAY)
  })

  it('declines an insertion shorter than one copy', () => {
    // a base of read error next to an array says nothing about where the array
    // ends, and moving the interval for it lays flanking bases out as copies
    expect(
      absorbAdjacentInsertions([read('a', [[999, 'CT']])], [ARRAY])[0],
    ).toEqual(ARRAY)
  })

  it('takes the outermost insertion when reads disagree', () => {
    const [widened] = absorbAdjacentInsertions(
      [
        read('a', [[999, 'CTG'.repeat(7)]]),
        read('b', [[998, 'CTG'.repeat(4)]]),
        read('c', [[1031, 'CTG'.repeat(9)]]),
      ],
      [ARRAY],
    )
    expect([widened!.start, widened!.end]).toEqual([998, 1031])
  })

  it('will not grow one array into its neighbour', () => {
    // two arrays sharing reference positions would measure the same read bases
    // twice and lay two blocks over one run of columns
    const neighbour: ReferenceArray = {
      start: 1032,
      end: 1080,
      period: 3,
      unit: 'CTG',
    }
    const [first, second] = absorbAdjacentInsertions(
      [read('a', [[1031, 'CTG'.repeat(7)]])],
      [ARRAY, neighbour],
    )
    // one of them may take the insertion, but they may not meet: the slot at
    // an array's `end` is one it reads, so a shared position is read twice
    expect(first!.end).toBeLessThan(second!.start)
  })

  it('counts the absorbed copies into the allele', () => {
    // the measurement this exists for: before widening, a read whose expansion
    // the aligner anchored outside the array is measured as the reference
    // allele, and its bases become a column block of their own
    const reads = [read('ref'), read('expanded', [[999, 'CTG'.repeat(7)]])]
    const before = buildArrayBlocks(reads, [ARRAY])[0]!
    expect(before.copiesByName.get('expanded')).toBe(10)

    const after = buildArrayBlocks(
      reads,
      absorbAdjacentInsertions(reads, [ARRAY]),
    )[0]!
    expect(after.copiesByName.get('expanded')).toBe(17)
    // every row is measured over the same widened interval, so the one extra
    // reference base lands on all of them and the counts stay comparable
    expect(after.lengthByName.get('ref')).toBe(
      before.lengthByName.get('ref')! + 1,
    )
    expect(after.lengthByName.get('expanded')).toBe(
      before.lengthByName.get('expanded')! + 1 + 21,
    )
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

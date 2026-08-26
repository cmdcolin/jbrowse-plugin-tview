import { describe, expect, it } from 'vitest'

import { findReferenceArrays, mergeArrays } from '../src/LaunchTView/repeats'

const FILLER = 'ACTGGATCCATGCTAGGTCAAGTCTGACTTGCAAGGATCCTAGGTCAATGCAAGTTCGGATC'

describe('findReferenceArrays', () => {
  it('finds a perfect array and reports its minimal period', () => {
    const arrays = findReferenceArrays(`${FILLER}${'CAG'.repeat(20)}${FILLER}`)
    expect(arrays).toHaveLength(1)
    expect(arrays[0]!.period).toBe(3)
    expect(arrays[0]!.unit).toBe('CAG')
    expect(arrays[0]!.start).toBe(FILLER.length)
    expect(arrays[0]!.end).toBe(FILLER.length + 60)
  })

  it('offsets the interval into reference coordinates', () => {
    const arrays = findReferenceArrays(
      `${FILLER}${'CAG'.repeat(20)}${FILLER}`,
      1000,
    )
    expect(arrays[0]!.start).toBe(1000 + FILLER.length)
  })

  it('reports a 30bp unit as 30, not as 60 or 90', () => {
    const unit = 'CCTCCTGGGTTCAAGCGATTCTCCTGCCTC'
    const arrays = findReferenceArrays(`${FILLER}${unit.repeat(8)}${FILLER}`)
    expect(arrays.map(a => a.period)).toEqual([30])
  })

  it('declines a homopolymer, which is periodic at every lag', () => {
    expect(findReferenceArrays(`${FILLER}${'A'.repeat(60)}${FILLER}`)).toEqual(
      [],
    )
  })

  it('declines a run too short to tell from chance', () => {
    // three copies of a dinucleotide is six bases, which turns up in any exon
    expect(findReferenceArrays(`${FILLER}TCTCTC${FILLER}`)).toEqual([])
  })

  it('declines two copies, which do not identify a period', () => {
    const unit = 'CCTCCTGGGTTCAAGCGATTCTCCTGCCTC'
    expect(findReferenceArrays(`${FILLER}${unit.repeat(2)}${FILLER}`)).toEqual(
      [],
    )
  })

  it('tolerates divergence between copies', () => {
    // every fourth copy carries a substitution, as a real VNTR does
    const unit = 'CCTCCTGGGTTCAAGCGATTCTCCTGCCTC'
    const variant = `A${unit.slice(1)}`
    const array = Array.from({ length: 12 }, (_, i) =>
      i % 4 === 3 ? variant : unit,
    ).join('')
    const arrays = findReferenceArrays(`${FILLER}${array}${FILLER}`)
    expect(arrays.map(a => a.period)).toEqual([30])
  })

  it('finds two separated arrays in one pass', () => {
    const arrays = findReferenceArrays(
      `${FILLER}${'CAG'.repeat(15)}${FILLER}${'ACTG'.repeat(15)}${FILLER}`,
    )
    expect(arrays.map(a => a.period)).toEqual([3, 4])
    expect(arrays[0]!.start).toBeLessThan(arrays[1]!.start)
  })

  it('does not report a long array again at a multiple of its period', () => {
    // 'CAG' x 40 is equally periodic at 6, 9 and 12; only the unit is reported
    const arrays = findReferenceArrays(`${FILLER}${'CAG'.repeat(40)}${FILLER}`)
    expect(arrays).toHaveLength(1)
    expect(arrays[0]!.period).toBe(3)
  })
})

describe('mergeArrays', () => {
  it('leaves separated arrays alone', () => {
    const arrays = [
      { start: 0, end: 30, period: 3, unit: 'CAG' },
      { start: 100, end: 140, period: 4, unit: 'ACTG' },
    ]
    expect(mergeArrays(arrays)).toEqual(arrays)
  })

  it('names an overlap by the shortest period that covers most of it', () => {
    // one locus scanned at three lags, as the ABCA7 VNTR is: the 25mer is what
    // it is known by, and the 77mer is three of those wearing one name
    const merged = mergeArrays([
      { start: 90, end: 247, period: 25, unit: 'A'.repeat(25) },
      { start: 216, end: 478, period: 77, unit: 'B'.repeat(77) },
      { start: 395, end: 556, period: 26, unit: 'C'.repeat(26) },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.period).toBe(25)
    expect(merged[0]!.start).toBe(90)
    expect(merged[0]!.end).toBe(556)
  })

  it('keeps a group open past a member that ends inside an earlier one', () => {
    // sorting by start says nothing about where a group reaches: the 3bp array
    // nested inside the long one ends at 20, and the third array still overlaps
    // the group. Closing on the last member's end would split them
    const merged = mergeArrays([
      { start: 0, end: 100, period: 2, unit: 'AT' },
      { start: 10, end: 20, period: 3, unit: 'CAG' },
      { start: 90, end: 150, period: 4, unit: 'ACGT' },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.end).toBe(150)
  })

  it('does not let a short microsatellite rename a VNTR it overlaps', () => {
    const merged = mergeArrays([
      { start: 100, end: 400, period: 30, unit: 'G'.repeat(30) },
      { start: 396, end: 410, period: 2, unit: 'TA' },
    ])
    expect(merged[0]!.period).toBe(30)
    expect(merged[0]!.end).toBe(410)
  })
})

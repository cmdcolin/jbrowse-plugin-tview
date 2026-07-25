import { describe, expect, it } from 'vitest'

import { buildTviewMsa, parseCigar, parseRead } from '../src/LaunchTView/tview'
import { buildColumnToRefPos } from '../src/TViewPanel/coords'

import type { AlignmentFeature } from '../src/LaunchTView/tview'

function feature(f: {
  name: string
  start: number
  CIGAR: string
  seq: string
  flags?: number
}): AlignmentFeature {
  return { get: (key: string) => f[key as keyof typeof f] }
}

function rows(msa: string) {
  return msa
    .trim()
    .split('\n')
    .reduce<[string, string][]>((acc, line, i, lines) => {
      return line.startsWith('>')
        ? [...acc, [line.slice(1), lines[i + 1] ?? '']]
        : acc
    }, [])
}

describe('parseCigar', () => {
  it('splits into length/op pairs', () => {
    expect(parseCigar('10M2I5M')).toEqual(['10', 'M', '2', 'I', '5', 'M'])
  })
})

describe('parseRead', () => {
  it('records insertions against the reference position they precede', () => {
    const read = parseRead(
      feature({ name: 'r', start: 100, CIGAR: '3M2I3M', seq: 'AAAGGCCC' }),
      'r',
    )
    expect(read.refChars).toBe('AAACCC')
    expect([...read.insertions]).toEqual([[103, 'GG']])
  })

  it('emits gaps for deletions and skips', () => {
    const read = parseRead(
      feature({ name: 'r', start: 0, CIGAR: '2M3D2M', seq: 'AACC' }),
      'r',
    )
    expect(read.refChars).toBe('AA---CC')
  })

  it('consumes soft clips from the read but not the reference', () => {
    const read = parseRead(
      feature({ name: 'r', start: 0, CIGAR: '2S4M', seq: 'TTAAAA' }),
      'r',
    )
    expect(read.refChars).toBe('AAAA')
  })

  it('consumes neither reference nor read for hard clips', () => {
    const read = parseRead(
      feature({ name: 'r', start: 0, CIGAR: '2H4M', seq: 'AAAA' }),
      'r',
    )
    expect(read.refChars).toBe('AAAA')
  })
})

describe('buildTviewMsa', () => {
  it('keeps rows the same length when insertions differ in width', () => {
    // r1 inserts 3 bases at pos 3, r2 inserts 1, r3 inserts none
    const { msa } = buildTviewMsa({
      features: [
        feature({ name: 'r1', start: 0, CIGAR: '3M3I3M', seq: 'AAAGGGCCC' }),
        feature({ name: 'r2', start: 0, CIGAR: '3M1I3M', seq: 'AAAGCCC' }),
        feature({ name: 'r3', start: 0, CIGAR: '6M', seq: 'AAACCC' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 6,
    })
    const lengths = new Set(rows(msa).map(([, seq]) => seq.length))
    expect(lengths.size).toBe(1)
    // 6 reference columns + 3 insertion columns at pos 3
    expect([...lengths][0]).toBe(9)
  })

  it('pads narrower and absent insertions so reference columns line up', () => {
    const { msa } = buildTviewMsa({
      features: [
        feature({ name: 'r1', start: 0, CIGAR: '3M3I3M', seq: 'AAAGGGCCC' }),
        feature({ name: 'r2', start: 0, CIGAR: '3M1I3M', seq: 'AAATCCC' }),
        feature({ name: 'r3', start: 0, CIGAR: '6M', seq: 'AAACCC' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 6,
    })
    expect(Object.fromEntries(rows(msa))).toEqual({
      r1: 'AAAGGGCCC',
      r2: 'AAAT--CCC',
      r3: 'AAA---CCC',
    })
  })

  it('reports insertion widths and pads reads that do not span the region', () => {
    const { msa, insertionWidths } = buildTviewMsa({
      features: [
        feature({ name: 'r1', start: 2, CIGAR: '2M2I2M', seq: 'AAGGCC' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 8,
    })
    expect(insertionWidths).toEqual([[4, 'GG'.length]])
    // 8 reference columns + 2 insertion columns; uncovered positions are '.'
    expect(Object.fromEntries(rows(msa))).toEqual({ r1: '..AAGGCC..' })
  })

  it('disambiguates duplicate read names', () => {
    const { msa } = buildTviewMsa({
      features: [
        feature({ name: 'r', start: 0, CIGAR: '2M', seq: 'AA', flags: 65 }),
        feature({ name: 'r', start: 0, CIGAR: '2M', seq: 'CC', flags: 129 }),
        feature({ name: 'r', start: 0, CIGAR: '2M', seq: 'GG' }),
        feature({ name: 'r', start: 0, CIGAR: '2M', seq: 'TT' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 2,
    })
    expect(rows(msa).map(([name]) => name)).toEqual(['r/1', 'r/2', 'r', 'r_2'])
  })
})

describe('buildColumnToRefPos', () => {
  it('inverts the column layout, insertion columns before their position', () => {
    // matches the 'AAAGGGCCC' layout above: 3 insertion columns at pos 3
    expect(
      buildColumnToRefPos({ start: 0, end: 6, insertionWidths: [[3, 3]] }),
    ).toEqual([0, 1, 2, 3, 3, 3, 3, 4, 5])
  })

  it('round-trips against the alignment buildTviewMsa produces', () => {
    const features = [
      feature({ name: 'r1', start: 0, CIGAR: '3M3I3M', seq: 'AAAGGGCCC' }),
      feature({ name: 'r2', start: 0, CIGAR: '5M2I1M', seq: 'AAAAAGGC' }),
    ]
    const { msa, insertionWidths, region } = buildTviewMsa({
      features,
      refName: 'ctgA',
      start: 0,
      end: 6,
    })
    const colToRefPos = buildColumnToRefPos({ ...region, insertionWidths })
    expect(colToRefPos.length).toBe(rows(msa)[0]![1].length)
    // every reference position in the region is reachable from some column
    expect([...new Set(colToRefPos)]).toEqual([0, 1, 2, 3, 4, 5])
  })
})

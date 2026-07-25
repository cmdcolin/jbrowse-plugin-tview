import { describe, expect, it } from 'vitest'

import { alignInsertions } from '../src/LaunchTView/align'

function widths(result: Map<string, string>) {
  return new Set([...result.values()].map(s => s.length))
}

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
})

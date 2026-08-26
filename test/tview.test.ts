import { describe, expect, it } from 'vitest'

import {
  buildTviewMsa,
  parseCigar,
  parseRead,
  planTviewMsa,
  renderTviewMsa,
} from '../src/LaunchTView/tview'
import {
  buildColumnToRefPos,
  renderedColToMsaCol,
} from '../src/TViewPanel/coords'

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

  it('emits a spanned gap for deletions', () => {
    const read = parseRead(
      feature({ name: 'r', start: 0, CIGAR: '2M3D2M', seq: 'AACC' }),
      'r',
    )
    expect(read.refChars).toBe('AA---CC')
  })

  it('emits an absence for reference skips, not a deletion', () => {
    const read = parseRead(
      feature({ name: 'r', start: 0, CIGAR: '2M3N2M', seq: 'AACC' }),
      'r',
    )
    expect(read.refChars).toBe('AA...CC')
  })

  it('consumes soft clips from the read but not the reference', () => {
    const read = parseRead(
      feature({ name: 'r', start: 0, CIGAR: '2S4M', seq: 'TTAAAA' }),
      'r',
    )
    expect(read.refChars).toBe('AAAA')
  })

  it('merges consecutive insertions at the same reference position', () => {
    const read = parseRead(
      feature({ name: 'r', start: 0, CIGAR: '3M2I3I3M', seq: 'AAAGGTTTCCC' }),
      'r',
    )
    expect(read.refChars).toBe('AAACCC')
    expect([...read.insertions]).toEqual([[3, 'GGTTT']])
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
    // where the inserted bases sit within the 3 insertion columns is up to
    // align.ts; what matters here is that the reference columns still line up
    expect(Object.fromEntries(rows(msa))).toEqual({
      r1: 'AAAGGGCCC',
      r2: 'AAA--TCCC',
      r3: 'AAA---CCC',
    })
  })

  it('aligns insertions that share an event but differ inside it', () => {
    const { msa } = buildTviewMsa({
      features: [
        // both insert ACGTACGT, but r2 is missing the T at offset 3
        feature({
          name: 'r1',
          start: 0,
          CIGAR: '1M8I1M',
          seq: 'AACGTACGTA',
        }),
        feature({ name: 'r2', start: 0, CIGAR: '1M7I1M', seq: 'AACGACGTA' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 2,
    })
    expect(Object.fromEntries(rows(msa))).toEqual({
      r1: 'AACGTACGTA',
      r2: 'AACG-ACGTA',
    })
  })

  it('distinguishes skipped reference from deleted reference', () => {
    const { msa } = buildTviewMsa({
      features: [
        feature({ name: 'del', start: 0, CIGAR: '1M3D1M', seq: 'AT' }),
        feature({ name: 'skip', start: 0, CIGAR: '1M3N1M', seq: 'AT' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 5,
    })
    expect(Object.fromEntries(rows(msa))).toEqual({
      del: 'A---T',
      skip: 'A...T',
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

  it('omits insertions from reads that fall outside the region', () => {
    const { insertionWidths } = buildTviewMsa({
      features: [
        feature({ name: 'r1', start: 2, CIGAR: '2M2I2M', seq: 'AAGGCC' }),
        feature({ name: 'r2', start: 100, CIGAR: '2M5I2M', seq: 'AAGGGGGCC' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 8,
    })
    expect(insertionWidths).toEqual([[4, 2]])
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

describe('planTviewMsa', () => {
  it('counts the cells the render would produce, without rendering', () => {
    const plan = planTviewMsa({
      features: [
        feature({ name: 'r1', start: 0, CIGAR: '3M3I3M', seq: 'AAAGGGCCC' }),
        feature({ name: 'r2', start: 0, CIGAR: '6M', seq: 'AAACCC' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 6,
    })
    // 6 reference columns + 3 insertion columns, over 2 rows
    expect(plan.layout.totalColumns).toBe(9)
    expect(plan.cellCount).toBe(18)
  })

  it('reports no array where the reference carries none', () => {
    const plan = planTviewMsa({
      features: [
        feature({ name: 'r1', start: 0, CIGAR: '3M3I3M', seq: 'AAAGGGCCC' }),
        feature({ name: 'r2', start: 0, CIGAR: '6M', seq: 'AAACCC' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 6,
      sequence: 'AAACCC',
    })
    expect(plan.arrays).toEqual([])
    expect(plan.subject).toBeUndefined()
    expect(plan.reads.map(r => r.name)).toEqual(['ctgA', 'r1', 'r2'])
  })
})

/**
 * The array lives in the reference and every read carries a whole allele, which
 * is what a real STR looks like — reads differ from the reference by an indel
 * *inside* the array, and the aligner is free to put that indel anywhere.
 */
describe('planTviewMsa on a reference tandem array', () => {
  const UNIT = 'CAG'
  const FLANK = 'TTGCAGGATC'
  const REF_COPIES = 10
  const START = 100
  const sequence = FLANK + UNIT.repeat(REF_COPIES) + FLANK

  /**
   * A read carrying `copies` copies, written as an indel at `anchor` bases into
   * the array — the same allele can be spelled many ways and every spelling has
   * to measure the same.
   */
  function strRead(name: string, copies: number, anchor: number) {
    const delta = (copies - REF_COPIES) * UNIT.length
    const arrayStart = START + FLANK.length
    const seq = FLANK + UNIT.repeat(copies) + FLANK
    const lead = FLANK.length + anchor
    const rest = REF_COPIES * UNIT.length - anchor + FLANK.length
    const cigar =
      delta > 0
        ? `${lead}M${delta}I${rest}M`
        : delta < 0
          ? `${lead}M${-delta}D${rest + delta}M`
          : `${sequence.length}M`
    return {
      feature: feature({ name, start: START, CIGAR: cigar, seq }),
      arrayStart,
    }
  }

  const reads = [
    strRead('expanded_early', 14, 3),
    strRead('expanded_late', 14, 21),
    strRead('reference_length', 10, 0),
    strRead('contracted', 7, 6),
  ]

  const plan = planTviewMsa({
    features: reads.map(r => r.feature),
    refName: 'chr1',
    start: START,
    end: START + sequence.length,
    sequence,
  })

  it('finds the array as a reference interval with the right unit', () => {
    expect(plan.arrays).toHaveLength(1)
    expect(plan.subject?.period).toBe(3)
    expect(plan.subject?.unit).toBe('CAG')
    expect(plan.subject?.start).toBe(START + FLANK.length)
    expect(plan.subject?.end).toBe(START + FLANK.length + REF_COPIES * 3)
  })

  it('measures the same allele the same however the aligner spelled it', () => {
    const copies = Object.fromEntries(plan.subject!.copiesByName)
    expect(copies.expanded_early).toBe(14)
    expect(copies.expanded_late).toBe(14)
  })

  it('counts a read that inserts nothing, and one that deletes', () => {
    const copies = Object.fromEntries(plan.subject!.copiesByName)
    expect(copies.reference_length).toBe(10)
    expect(copies.contracted).toBe(7)
  })

  it('counts the reference as an allele of its own', () => {
    expect(plan.subject!.copiesByName.get('chr1')).toBe(REF_COPIES)
  })

  it('labels each row with its copy count and keeps the reference on top', () => {
    expect(plan.reads.map(r => r.label)).toEqual([
      'chr1|n=10',
      'expanded_early|n=14',
      'expanded_late|n=14',
      'reference_length|n=10',
      'contracted|n=7',
    ])
  })

  it('labels without renaming, so the blocks keyed by name still resolve', () => {
    // the label is added after the array blocks are built and keyed. Renaming
    // in place instead left every labelled row unable to find its own block —
    // it fell back to gaps, and the row rendered blank under its own label
    expect(plan.reads.map(r => r.name)).toEqual([
      'chr1',
      'expanded_early',
      'expanded_late',
      'reference_length',
      'contracted',
    ])
  })

  it('keeps the label in one defline token, which FastaMSA truncates at', () => {
    for (const read of plan.reads) {
      expect(read.label).not.toContain(' ')
    }
  })

  it('puts copy k of every row in the same columns', () => {
    const block = plan.subject!
    // the two 14-copy reads carry the same allele, so their blocks are equal
    expect(block.rowByName.get('expanded_early')).toBe(
      block.rowByName.get('expanded_late'),
    )
    // and every row's block is the same width, so the copies stay in register
    const widths = [...block.rowByName.values()].map(r => r.length)
    expect(new Set(widths)).toEqual(new Set([block.width]))
  })

  it('renders every row with its flanks, its block and nothing absent', () => {
    const rendered = rows(renderTviewMsa(plan))
    expect(rendered.map(([name]) => name)).toEqual([
      'chr1|n=10',
      'expanded_early|n=14',
      'expanded_late|n=14',
      'reference_length|n=10',
      'contracted|n=7',
    ])
    for (const [name, seq] of rendered) {
      expect(seq.length).toBe(plan.layout.totalColumns)
      // every row spans the whole region, so nothing is outside it
      expect(seq).not.toContain('.')
      // the flanks are matched bases, not the block
      expect(seq.startsWith(FLANK)).toBe(true)
      expect(seq.endsWith(FLANK)).toBe(true)
      // and the array block is the row's own allele, not a run of gaps
      const copies = Number(/n=(\d+)/.exec(name)![1])
      expect(
        seq.split('').filter(c => c === 'C').length,
      ).toBeGreaterThanOrEqual(copies)
    }
  })
})

describe('rows at an array block that carry no copies of it', () => {
  const UNIT = 'CAG'
  const FLANK = 'TTGCAGGATC'
  const REF_COPIES = 10
  const START = 100
  const ARRAY_BP = REF_COPIES * UNIT.length
  const sequence = FLANK + UNIT.repeat(REF_COPIES) + FLANK

  const plan = planTviewMsa({
    features: [
      feature({
        name: 'deleted',
        start: START,
        CIGAR: `${FLANK.length}M${ARRAY_BP}D${FLANK.length}M`,
        seq: FLANK + FLANK,
      }),
      feature({
        name: 'introned',
        start: START,
        CIGAR: `${FLANK.length}M${ARRAY_BP}N${FLANK.length}M`,
        seq: FLANK + FLANK,
      }),
      feature({
        name: 'stops_one_short',
        start: START,
        CIGAR: `${FLANK.length + ARRAY_BP - 1}M`,
        seq: sequence.slice(0, FLANK.length + ARRAY_BP - 1),
      }),
    ],
    refName: 'chr1',
    start: START,
    end: START + sequence.length,
    sequence,
  })
  const block = plan.subject!
  const rendered = new Map(rows(renderTviewMsa(plan)))
  const atBlock = (defline: string) =>
    rendered.get(defline)!.slice(FLANK.length, FLANK.length + block.width)

  it('measures a row that deletes the whole array as nought copies', () => {
    // the most contracted allele there is, and a measurement like any other —
    // dropping it left the row indistinguishable from one that never got here
    expect(block.copiesByName.get('deleted')).toBe(0)
    expect(block.lengthByName.get('deleted')).toBe(0)
    expect(atBlock('deleted|n=0')).toBe('-'.repeat(block.width))
  })

  it('measures nothing for a row that skips the array through an N', () => {
    expect(block.copiesByName.has('introned')).toBe(false)
    expect(block.copiesByName.has('stops_one_short')).toBe(false)
  })

  it('renders a row it could not measure as absent, not as a deletion', () => {
    expect(atBlock('introned')).toBe('.'.repeat(block.width))
    expect(atBlock('stops_one_short')).toBe('.'.repeat(block.width))
  })
})

describe('renderedColToMsaCol', () => {
  it('is the identity when nothing is hidden', () => {
    expect([0, 1, 2].map(c => renderedColToMsaCol([], c))).toEqual([0, 1, 2])
  })

  it('skips past hidden all-gap columns', () => {
    // full columns 1 and 3 are hidden, so rendered 0..2 -> full 0, 2, 4
    expect([0, 1, 2].map(c => renderedColToMsaCol([1, 3], c))).toEqual([
      0, 2, 4,
    ])
  })

  it('handles hidden columns at the start', () => {
    expect([0, 1].map(c => renderedColToMsaCol([0, 1], c))).toEqual([2, 3])
  })
})

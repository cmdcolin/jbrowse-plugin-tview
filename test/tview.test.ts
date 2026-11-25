import { describe, expect, it } from 'vitest'

import {
  REFERENCE,
  buildTviewMsa,
  parseCigar,
  parseRead,
  planHighlights,
  planRowData,
  planTviewMsa,
  renderTviewMsa,
} from '../src/LaunchTView/tview'

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

  it('merges equivalent placements of one insertion into one site', () => {
    // both reads spell TTTT CACACACA GGGG; the aligner anchored the extra CA at
    // either end of a run too short to be a tandem array
    const sequence = 'TTTTCACACAGGGG'
    const { msa, insertionWidths, arrays } = buildTviewMsa({
      features: [
        feature({
          name: 'left',
          start: 0,
          CIGAR: '4M2I10M',
          seq: 'TTTTCACACACAGGGG',
        }),
        feature({
          name: 'right',
          start: 0,
          CIGAR: '10M2I4M',
          seq: 'TTTTCACACACAGGGG',
        }),
      ],
      refName: 'ctgA',
      start: 0,
      end: sequence.length,
      sequence,
    })
    expect(arrays).toEqual([])
    expect(insertionWidths).toEqual([[4, 2]])
    const byName = Object.fromEntries(rows(msa))
    expect(byName.left).toBe(byName.right)
    expect(byName.left).toBe('TTTTCACACACAGGGG')
  })

  it('renders identical rows for one 250bp insertion with a base missing', () => {
    let state = 1
    let inserted = ''
    while (inserted.length < 250) {
      state = (state * 48271) % 2147483647
      inserted += 'ACGT'[Math.floor((state / 2147483647) * 4)]
    }
    const shorter = inserted.slice(0, 120) + inserted.slice(121)
    const { msa } = buildTviewMsa({
      features: [
        feature({
          name: 'r1',
          start: 0,
          CIGAR: `2M${inserted.length}I2M`,
          seq: `AA${inserted}TT`,
        }),
        feature({
          name: 'r2',
          start: 0,
          CIGAR: `2M${shorter.length}I2M`,
          seq: `AA${shorter}TT`,
        }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 4,
    })
    const [[, a], [, b]] = rows(msa)
    let differing = ''
    for (let i = 0; i < a!.length; i++) {
      differing += a![i] === b![i] ? '' : a![i]
    }
    expect(differing).toBe(inserted[120])
  })

  it('pads a read that begins at an insertion site as absent', () => {
    // the read has no base before position 3, so it does not span the
    // insertion columns there; '-' would claim it does, without the insertion
    const { msa } = buildTviewMsa({
      features: [
        feature({ name: 'r1', start: 0, CIGAR: '3M2I3M', seq: 'AAAGGCCC' }),
        feature({ name: 'r2', start: 3, CIGAR: '3M', seq: 'CCC' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 6,
    })
    expect(Object.fromEntries(rows(msa))).toEqual({
      r1: 'AAAGGCCC',
      r2: '.....CCC',
    })
  })

  it('pads a read that resumes after an intron at an insertion site as absent', () => {
    const { msa } = buildTviewMsa({
      features: [
        feature({ name: 'r1', start: 0, CIGAR: '3M2I3M', seq: 'AAAGGCCC' }),
        feature({ name: 'r2', start: 0, CIGAR: '1M2N3M', seq: 'ACCC' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 6,
    })
    expect(Object.fromEntries(rows(msa))).toEqual({
      r1: 'AAAGGCCC',
      r2: 'A....CCC',
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
    expect(plan.reads.map(r => r.name)).toEqual([REFERENCE, 'r1', 'r2'])
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
    expect(plan.subject!.copiesByName.get(REFERENCE)).toBe(REF_COPIES)
  })

  it('keeps the rows in genomic order, the reference first', () => {
    expect(plan.reads.map(r => r.name)).toEqual([
      REFERENCE,
      'expanded_early',
      'expanded_late',
      'reference_length',
      'contracted',
    ])
  })

  it('gives each row its copies and allele length in the row table', () => {
    expect(planRowData(plan)).toEqual({
      [REFERENCE]: { sample: REFERENCE, copies: 10, alleleBp: 30 },
      expanded_early: { copies: 14, alleleBp: 42 },
      expanded_late: { copies: 14, alleleBp: 42 },
      reference_length: { copies: 10, alleleBp: 30 },
      contracted: { copies: 7, alleleBp: 21 },
    })
  })

  it('brackets the array block, naming its unit and the reference count', () => {
    const column = FLANK.length + 1
    expect(planHighlights(plan)).toEqual([
      {
        start: column,
        end: column + plan.subject!.width - 1,
        label: '(CAG)x10 in the reference',
        mark: 'bracket',
      },
    ])
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
    const copiesOf = Object.fromEntries(plan.subject!.copiesByName)
    for (const [name, seq] of rendered) {
      expect(seq.length).toBe(plan.layout.totalColumns)
      // every row spans the whole region, so nothing is outside it
      expect(seq).not.toContain('.')
      // the flanks are matched bases, not the block
      expect(seq.startsWith(FLANK)).toBe(true)
      expect(seq.endsWith(FLANK)).toBe(true)
      // and the array block is the row's own allele, not a run of gaps
      const copies = copiesOf[name]!
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
    expect(atBlock('deleted')).toBe('-'.repeat(block.width))
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

describe('the row table', () => {
  const sequence = 'AAACCC'
  const samples = ['HG002 (son)', 'HG002 (son)', 'HG003', 'HG003']
  const plan = planTviewMsa({
    features: [
      feature({ name: 'read 1', start: 0, CIGAR: '6M', seq: 'AAACCC' }),
      feature({ name: 'shared', start: 1, CIGAR: '5M', seq: 'AACCC' }),
      feature({ name: 'shared', start: 0, CIGAR: '6M', seq: 'AAACCC' }),
      feature({ name: REFERENCE, start: 2, CIGAR: '4M', seq: 'ACCC' }),
    ],
    refName: 'chr1',
    start: 0,
    end: sequence.length,
    sequence,
    sampleOf: i => samples[i],
  })

  it('names each row by its sample, the reference by its own', () => {
    expect(planRowData(plan)).toEqual({
      [REFERENCE]: { sample: REFERENCE },
      read_1: { sample: 'HG002 (son)' },
      shared_2: { sample: 'HG003' },
      shared: { sample: 'HG002 (son)' },
      [`${REFERENCE}_2`]: { sample: 'HG003' },
    })
  })

  it('gives every row a unique name with no whitespace, across samples', () => {
    const names = rows(renderTviewMsa(plan)).map(([name]) => name)
    expect(new Set(names).size).toBe(plan.reads.length)
    for (const name of names) {
      expect(name).not.toMatch(/\s/)
    }
  })

  it('lists the samples in the order they were given', () => {
    expect(plan.samples).toEqual(['HG002 (son)', 'HG003'])
  })

  it('keeps that order when a later sample has the leftmost read', () => {
    const ordered = planTviewMsa({
      features: [
        feature({ name: 'late', start: 5, CIGAR: '4M', seq: 'ACGT' }),
        feature({ name: 'early', start: 0, CIGAR: '4M', seq: 'ACGT' }),
      ],
      refName: 'ctgA',
      start: 0,
      end: 10,
      sampleOf: i => ['first track', 'second track'][i],
    })
    expect(ordered.samples).toEqual(['first track', 'second track'])
  })

  it('leaves copies out where there is no array', () => {
    for (const entry of Object.values(planRowData(plan))) {
      expect(entry).not.toHaveProperty('copies')
    }
  })
})

describe('planHighlights', () => {
  it('labels a site with the length most reads insert, not its column count', () => {
    const reference = 'ACGTTGCA'
    const withInsertion = (name: string, ins: string) =>
      feature({
        name,
        start: 0,
        CIGAR: `4M${ins.length}I4M`,
        seq: `${reference.slice(0, 4)}${ins}${reference.slice(4)}`,
      })
    const plan = planTviewMsa({
      features: [
        withInsertion('a', 'GGCC'),
        withInsertion('b', 'GGCC'),
        withInsertion('c', 'GGACC'),
        withInsertion('d', 'GCC'),
      ],
      refName: 'ctgA',
      start: 0,
      end: reference.length,
    })
    expect(plan.layout.insWidths.get(4)).toBeGreaterThan(4)
    expect(planHighlights(plan).map(h => h.label)).toEqual([
      '+4bp after ctgA:4',
    ])
  })

  it('marks only the sites carrying the most inserted sequence', () => {
    const reference = 'ACGT'.repeat(120)
    const noise = Array.from({ length: 150 }, (_, i) =>
      feature({
        name: `noise${i}`,
        start: 0,
        CIGAR: `${2 * i + 10}M1I${reference.length - 2 * i - 10}M`,
        seq: `${reference.slice(0, 2 * i + 10)}N${reference.slice(2 * i + 10)}`,
      }),
    )
    const event = ['a', 'b'].map(name =>
      feature({
        name,
        start: 0,
        CIGAR: `400M9I${reference.length - 400}M`,
        seq: `${reference.slice(0, 400)}GGGGGGGGG${reference.slice(400)}`,
      }),
    )
    const highlights = planHighlights(
      planTviewMsa({
        features: [...noise, ...event],
        refName: 'ctgA',
        start: 0,
        end: reference.length,
      }),
    )
    expect(highlights).toHaveLength(100)
    expect(highlights.some(h => h.label === '+9bp after ctgA:400')).toBe(true)
  })
  it('brackets each insertion site in 1-based file columns', () => {
    const plan = planTviewMsa({
      features: [
        feature({ name: 'r1', start: 100, CIGAR: '3M3I3M', seq: 'AAAGGGCCC' }),
        feature({ name: 'r2', start: 100, CIGAR: '5M1I1M', seq: 'AAACCTC' }),
      ],
      refName: 'ctgA',
      start: 100,
      end: 106,
    })
    // AAA GGG CC T C: the sites follow 1-based bases 103 and 105
    expect(planHighlights(plan)).toEqual([
      { start: 4, end: 6, label: '+3bp after ctgA:103', mark: 'bracket' },
      { start: 9, end: 9, label: '+1bp after ctgA:105', mark: 'bracket' },
    ])
  })

  it('marks nothing over a region with no insertion or array', () => {
    const plan = planTviewMsa({
      features: [feature({ name: 'r', start: 0, CIGAR: '4M', seq: 'ACGT' })],
      refName: 'ctgA',
      start: 0,
      end: 4,
    })
    expect(planHighlights(plan)).toEqual([])
  })
})

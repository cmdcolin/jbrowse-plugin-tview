import { BamFile } from '@gmod/bam'
import { IndexedFasta } from '@gmod/indexedfasta'
import SimpleFeature from '@jbrowse/core/util/simpleFeature'
import { getModPositions } from '@jbrowse/modifications-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { planModifications } from '../src/LaunchTView/modifications'
import { REFERENCE, planTviewMsa, renderRows } from '../src/LaunchTView/tview'

import type * as ModificationsUtils from '@jbrowse/modifications-utils'

vi.mock('@jbrowse/modifications-utils', async importOriginal => {
  const actual = await importOriginal<typeof ModificationsUtils>()
  return { ...actual, getModPositions: vi.fn(actual.getModPositions) }
})

/** the column a row draws its `residue`th letter in, 1-based as annotations are */
function columnOfResidue(row: string, residue: number) {
  return [...row.matchAll(/[^-.]/g)][residue - 1]?.index ?? -1
}

beforeEach(() => {
  vi.mocked(getModPositions).mockClear()
})

interface ReadSpec {
  name: string
  start: number
  CIGAR: string
  seq: string
  strand?: -1 | 1
  MM?: string
  ML?: number[]
}

function read({ name, start, CIGAR, seq, strand = 1, MM, ML }: ReadSpec) {
  return new SimpleFeature({
    uniqueId: name,
    name,
    start,
    end: start + seq.length,
    CIGAR,
    seq,
    strand,
    flags: strand === -1 ? 16 : 0,
    tags: MM ? { MM, ML } : {},
  })
}

function project(
  reads: ReadSpec[],
  window: { start: number; sequence: string },
  maxCalls?: number,
) {
  const features = reads.map(read)
  const plan = planTviewMsa({
    features,
    refName: 'chr1',
    start: window.start,
    end: window.start + window.sequence.length,
    sequence: window.sequence,
  })
  const rows = renderRows(plan)
  const modifications = planModifications({ features, plan, rows, maxCalls })
  const rowOf = (name: string) =>
    rows[plan.reads.findIndex(r => r.name === name)]!
  const calls = modifications
    ? Array.from(modifications.row, (r, i) => ({
        row: modifications.rows[r]!,
        residue: modifications.residue[i]!,
        type: modifications.types[modifications.type[i]!]!,
        prob: modifications.prob[i]!,
      }))
    : []
  const columnOf = ({ row, residue }: { row: string; residue: number }) =>
    columnOfResidue(rowOf(row), residue)
  return { modifications, calls, rowOf, columnOf }
}

describe('planModifications', () => {
  const window = { start: 100, sequence: 'ACGTACGTCC' }

  it('places a forward read calls on the cytosines MM counts from its start', () => {
    const { calls, rowOf, columnOf } = project(
      [
        {
          name: 'fwd',
          start: 100,
          CIGAR: '10M',
          seq: 'ACGTACGTCC',
          MM: 'C+m,0,1;',
          ML: [200, 100],
        },
      ],
      window,
    )
    expect(calls).toEqual([
      { row: 'fwd', residue: 2, type: 'm', prob: 200 },
      { row: 'fwd', residue: 9, type: 'm', prob: 100 },
    ])
    expect(calls.map(c => rowOf('fwd')[columnOf(c)])).toEqual(['C', 'C'])
  })

  it('places a reverse read calls on the guanines SEQ stores, counted from its end', () => {
    const { calls, rowOf, columnOf } = project(
      [
        {
          name: 'rev',
          start: 100,
          CIGAR: '10M',
          seq: 'ACGTACGTCC',
          strand: -1,
          MM: 'C+m,1;',
          ML: [150],
        },
      ],
      window,
    )
    expect(calls).toEqual([{ row: 'rev', residue: 3, type: 'm', prob: 150 }])
    expect(rowOf('rev')[columnOf(calls[0]!)]).toBe('G')
  })

  it('lands a call on an inserted base, past a soft clip and a deletion', () => {
    // CG|AAA CC TT - AAA: the clipped C is called too, and is not drawn
    const { calls, rowOf, columnOf } = project(
      [
        {
          name: 'indel',
          start: 100,
          CIGAR: '2S3M2I2M1D3M',
          seq: 'CGAAACCTTAAA',
          MM: 'C+m,0,1;',
          ML: [250, 230],
        },
        { name: 'plain', start: 100, CIGAR: '9M', seq: 'AAATTGAAA' },
      ],
      { start: 100, sequence: 'AAATTGAAA' },
    )
    expect(rowOf('indel')).toBe('AAACCTT-AAA')
    expect(rowOf(REFERENCE)).toBe('AAA--TTGAAA')
    expect(calls).toEqual([{ row: 'indel', residue: 5, type: 'm', prob: 230 }])
    const column = columnOf(calls[0]!)
    expect(column).toBe(4)
    expect(rowOf('indel')[column]).toBe('C')
    expect(rowOf(REFERENCE)[column]).toBe('-')
  })

  it('keeps only the calls on the part of a read inside the window', () => {
    // the read covers 95..109 and the window 100..105, its sixth to eleventh
    // bases, which hold the sixth and seventh of its eleven calls
    const { calls } = project(
      [
        {
          name: 'long',
          start: 95,
          CIGAR: '15M',
          seq: 'CCCCCACGTCCCCCC',
          MM: 'C+m,0,0,0,0,0,1,0,0,0,0,0;',
          ML: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        },
      ],
      { start: 100, sequence: 'ACGTCC' },
    )
    expect(calls).toEqual([
      { row: 'long', residue: 5, type: 'm', prob: 6 },
      { row: 'long', residue: 6, type: 'm', prob: 7 },
    ])
  })

  it('keeps the most probable type where several are called on one base', () => {
    const { calls } = project(
      [
        {
          name: 'mh',
          start: 100,
          CIGAR: '10M',
          seq: 'ACGTACGTCC',
          MM: 'C+mh,0,0;',
          ML: [100, 200, 180, 20],
        },
      ],
      window,
    )
    expect(calls).toEqual([
      { row: 'mh', residue: 2, type: 'h', prob: 200 },
      { row: 'mh', residue: 6, type: 'm', prob: 180 },
    ])
  })

  it('keeps the most probable calls over the cap, and counts the rest', () => {
    const { modifications, calls } = project(
      [
        {
          name: 'many',
          start: 100,
          CIGAR: '10M',
          seq: 'ACGTACGTCC',
          MM: 'C+m,0,0,0,0;',
          ML: [10, 250, 30, 240],
        },
      ],
      window,
      2,
    )
    expect(calls.map(c => c.prob)).toEqual([250, 240])
    expect(modifications?.dropped).toBe(2)
  })

  it('annotates no row whose letters the layout reordered, and counts it', () => {
    // an out-of-phase repeat insertion anchored two bases before a CAG array
    // has no exact rewrite into it, so its bases move as written and the row
    // no longer reads as one run of the read
    const FLANK = 'TTGCAGGATC'
    const sequence = FLANK + 'CAG'.repeat(10) + FLANK
    const inserted = 'GCAGCAGCAGCA'
    const moved = {
      name: 'moved',
      start: 100,
      CIGAR: `8M${inserted.length}I${sequence.length - 8}M`,
      seq: FLANK.slice(0, 8) + inserted + sequence.slice(8),
      MM: 'C+m,0;',
      ML: [255],
    }
    const plain = {
      name: 'plain',
      start: 100,
      CIGAR: `${sequence.length}M`,
      seq: sequence,
      MM: 'C+m,0;',
      ML: [255],
    }
    const { modifications, calls } = project([moved, plain], {
      start: 100,
      sequence,
    })
    expect(modifications?.unplaced).toBe(1)
    expect(calls).toEqual([{ row: 'plain', residue: 4, type: 'm', prob: 255 }])
  })

  it('does nothing when no read carries an MM tag', () => {
    const { modifications } = project(
      [{ name: 'bare', start: 100, CIGAR: '10M', seq: 'ACGTACGTCC' }],
      window,
    )
    expect(modifications).toBeUndefined()
    expect(getModPositions).not.toHaveBeenCalled()
  })
})

describe('planModifications on a real nanopore clip', () => {
  it('puts every call on its base, inserted bases included', async () => {
    const bam = new BamFile({
      bamPath: 'public/methylation_clip.bam',
      baiPath: 'public/methylation_clip.bam.bai',
    })
    await bam.getHeader()
    const fasta = new IndexedFasta({
      path: 'public/hg38_clip.fa',
      faiPath: 'public/hg38_clip.fa.fai',
    })
    const start = 13_000
    const end = 13_400
    const records = await bam.getRecordsForRange('20', start, end)
    const features = records.map(
      r =>
        new SimpleFeature({
          uniqueId: r.name,
          name: r.name,
          start: r.start,
          end: r.end,
          CIGAR: r.CIGAR,
          seq: r.seq,
          strand: r.strand,
          flags: r.flags,
          tags: r.tags,
        }),
    )
    const plan = planTviewMsa({
      features,
      refName: '20',
      start,
      end,
      sequence: await fasta.getSequence('20', start, end),
    })
    const rows = renderRows(plan)
    const mods = planModifications({ features, plan, rows })!
    const strandOf = new Map(
      features.map((f, i) => [plan.featureNames[i]!, f.get('strand')]),
    )
    const reference = rows[0]!
    const cells = Array.from(mods.row, (r, i) => {
      const name = mods.rows[r]!
      const row = rows[plan.reads.findIndex(x => x.name === name)]!
      const column = columnOfResidue(row, mods.residue[i]!)
      return {
        letter: row[column],
        expected: strandOf.get(name) === -1 ? 'G' : 'C',
        inserted: reference[column] === '-',
      }
    })
    expect(cells.length).toBeGreaterThan(10)
    expect(mods.unplaced).toBe(0)
    expect(cells.filter(c => c.letter !== c.expected)).toEqual([])
    expect(cells.filter(c => c.inserted).length).toBeGreaterThan(0)
  })
})

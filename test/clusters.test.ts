import { describe, expect, it } from 'vitest'

import { clusterReads } from '../src/LaunchTView/clusters'
import { REFERENCE, parseRead, planTviewMsa } from '../src/LaunchTView/tview'

import type { AlignmentFeature } from '../src/LaunchTView/tview'

const REF = 'ACGTTGCAACGTAGCTTACGGATCCAGTAC'

function feature(f: {
  name: string
  start: number
  CIGAR: string
  seq: string
}): AlignmentFeature {
  return { get: (key: string) => f[key as keyof typeof f] }
}

const ALU = 'GGCCGGGCGCGG'

function withInsertion(name: string) {
  return feature({
    name,
    start: 0,
    CIGAR: `15M${ALU.length}I15M`,
    seq: REF.slice(0, 15) + ALU + REF.slice(15),
  })
}

function plain(name: string, seq = REF) {
  return feature({ name, start: 0, CIGAR: `${seq.length}M`, seq })
}

function snv(seq: string, pos: number, base: string) {
  return seq.slice(0, pos) + base + seq.slice(pos + 1)
}

function plan(features: AlignmentFeature[], samples?: string[]) {
  return planTviewMsa({
    features,
    refName: 'chr1',
    start: 0,
    end: REF.length,
    sequence: REF,
    sampleOf: samples ? i => samples[i] : undefined,
  })
}

function groups(clusters: Map<string, string>) {
  const ret: Record<string, string[]> = {}
  for (const [name, group] of clusters) {
    ret[group] = [...(ret[group] ?? []), name].sort()
  }
  return ret
}

describe('clusterReads', () => {
  it('puts the reads with an insertion in one group and the rest in another', () => {
    const p = plan([
      withInsertion('ins1'),
      plain('ref1'),
      withInsertion('ins2'),
      plain('ref2'),
      withInsertion('ins3'),
      plain('ref3'),
    ])
    expect(groups(p.clusters)).toEqual({
      A: ['ins1', 'ins2', 'ins3'],
      B: ['ref1', 'ref2', 'ref3'],
    })
  })

  it('leaves out a read that does not span the insertion site', () => {
    const p = plan([
      withInsertion('ins1'),
      withInsertion('ins2'),
      plain('ref1'),
      plain('ref2'),
      feature({ name: 'short', start: 0, CIGAR: '10M', seq: REF.slice(0, 10) }),
    ])
    expect(p.clusters.has('short')).toBe(false)
    expect(groups(p.clusters)).toEqual({
      A: ['ins1', 'ins2'],
      B: ['ref1', 'ref2'],
    })
  })

  it('splits on a heterozygous base and ignores one read with an error', () => {
    const alt = snv(REF, 5, 'A')
    const p = plan([
      plain('alt1', alt),
      plain('alt2', alt),
      plain('alt3', snv(alt, 20, 'T')),
      plain('ref1'),
      plain('ref2'),
      plain('ref3'),
    ])
    expect(groups(p.clusters)).toEqual({
      A: ['alt1', 'alt2', 'alt3'],
      B: ['ref1', 'ref2', 'ref3'],
    })
  })

  it('gives no groups where the reads agree', () => {
    const p = plan([
      plain('r1'),
      plain('r2'),
      plain('r3', snv(REF, 8, 'T')),
      plain('r4'),
    ])
    expect(p.clusters.size).toBe(0)
  })

  it('groups each sample on its own, the insertion first in every band', () => {
    const p = plan(
      [
        plain('son_ref1'),
        withInsertion('son_ins1'),
        plain('son_ref2'),
        withInsertion('son_ins2'),
        plain('mother1'),
        plain('mother2'),
        withInsertion('father_ins1'),
        plain('father_ref1'),
        withInsertion('father_ins2'),
        plain('father_ref2'),
      ],
      [
        'son',
        'son',
        'son',
        'son',
        'mother',
        'mother',
        'father',
        'father',
        'father',
        'father',
      ],
    )
    expect(groups(p.clusters)).toEqual({
      A: ['father_ins1', 'father_ins2', 'son_ins1', 'son_ins2'],
      B: ['father_ref1', 'father_ref2', 'son_ref1', 'son_ref2'],
    })
  })

  it('never groups the reference row', () => {
    const reads = [
      withInsertion('a'),
      withInsertion('b'),
      plain('c'),
      plain('d'),
    ]
    const parsed = [
      {
        name: REFERENCE,
        sample: REFERENCE,
        start: 0,
        refChars: REF,
        insertions: new Map<number, string>(),
      },
      ...reads.map(f => parseRead(f, String(f.get('name')))),
    ]
    expect(
      clusterReads(parsed, [], { start: 0, end: REF.length }, REFERENCE).has(
        REFERENCE,
      ),
    ).toBe(false)
  })
})

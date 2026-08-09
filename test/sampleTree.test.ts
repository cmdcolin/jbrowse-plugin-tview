import { describe, expect, it } from 'vitest'

import { buildSampleTree } from '../src/LaunchTView/sampleTree'
import { planTviewMsa, renderTviewMsa } from '../src/LaunchTView/tview'

import type { AlignmentFeature } from '../src/LaunchTView/tview'

function feature(f: {
  name: string
  start: number
  CIGAR: string
  seq: string
}): AlignmentFeature {
  return { get: (key: string) => f[key as keyof typeof f] }
}

// carries a CAG array, so the rows get copy-number labels and the tree has to
// name the labels rather than the identities
const REF = `ACTGGATCCATG${'CAG'.repeat(12)}CTAGGTCAAGTCTGACTTGCAAGG`

function planWithSamples(samples: string[]) {
  const features = samples.map((_, i) =>
    feature({
      name: `read${i}`,
      start: 0,
      CIGAR: `${REF.length}M`,
      seq: REF,
    }),
  )
  return planTviewMsa({
    features,
    refName: 'chrX',
    start: 0,
    end: REF.length,
    sequence: REF,
    sampleOf: i => samples[i],
  })
}

/** the deflines the alignment actually carries */
function deflines(msa: string) {
  return msa
    .trim()
    .split('\n')
    .filter(line => line.startsWith('>'))
    .map(line => line.slice(1))
}

/**
 * Every leaf name a Newick string mentions. A leaf follows `(` or `,`; a name
 * following `)` labels the clade that just closed, and is not a row.
 */
function leafNames(newick: string) {
  return [...newick.matchAll(/[(,]([^(),;:]+):/g)].map(m => m[1]!)
}

describe('buildSampleTree', () => {
  it('groups rows into a clade per sample', () => {
    const tree = buildSampleTree([
      { name: 'ref' },
      { name: 'A|r1', sample: 'A' },
      { name: 'A|r2', sample: 'A' },
      { name: 'B|r1', sample: 'B' },
    ])
    expect(tree).toBe('(ref:1,(A|r1:1,A|r2:1)A:1,(B|r1:1)B:1);')
  })

  it('declines a tree for one sample, which it would only draw a line beside', () => {
    expect(
      buildSampleTree([
        { name: 'r1', sample: 'A' },
        { name: 'r2', sample: 'A' },
      ]),
    ).toBeUndefined()
    expect(buildSampleTree([{ name: 'r1' }, { name: 'r2' }])).toBeUndefined()
  })
})

/**
 * react-msaview joins a tree leaf to an alignment row by name. A sanitizer
 * applied on the way into the Newick and not to the defline renders every
 * affected row blank while still listing it in the tree, which reads as a
 * rendering fault rather than a naming one — and a track called
 * `HG004 (mother)` is enough to cause it.
 */
describe('tree leaf names and FASTA deflines', () => {
  it('agree when the sample name carries Newick punctuation', () => {
    const plan = planWithSamples([
      'HG004 (mother)',
      'HG004 (mother)',
      'HG003 (father)',
    ])
    const tree = buildSampleTree(plan.reads)!
    expect(new Set(leafNames(tree))).toEqual(
      new Set(deflines(renderTviewMsa(plan))),
    )
  })

  it('agree when the rows carry a copy-number label', () => {
    const plan = planWithSamples(['A', 'A', 'B'])
    // the array is what puts a label on every row, so this is the case the
    // identity and the defline differ
    expect(plan.subject).toBeDefined()
    expect(plan.reads.every(r => r.label)).toBe(true)
    const tree = buildSampleTree(plan.reads)!
    expect(new Set(leafNames(tree))).toEqual(
      new Set(deflines(renderTviewMsa(plan))),
    )
  })

  it('leaves no reserved Newick character in a defline', () => {
    const plan = planWithSamples(['S 1', 'S 1', 'S:2'])
    for (const line of deflines(renderTviewMsa(plan))) {
      expect(line).not.toMatch(/[(),:;[\]'\s]/)
    }
  })

  it('leaves no reserved Newick character in a clade label either', () => {
    const plan = planWithSamples([
      'HG004 (mother)',
      'HG004 (mother)',
      'HG003 (father)',
    ])
    const tree = buildSampleTree(plan.reads)!
    // a clade label goes in unquoted too; unsanitized, `)HG004 (mother):1`
    // reopens a group and the whole string stops parsing
    expect(tree).toContain(')HG004_mother:1')
    expect(tree).toContain(')HG003_father:1')
  })
})

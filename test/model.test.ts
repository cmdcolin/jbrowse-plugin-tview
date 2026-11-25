import { getSnapshot } from '@jbrowse/mobx-state-tree'
import { observable } from 'mobx'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSession } from './fakeSession'
import { fetchTviewPlan } from '../src/LaunchTView/fetchTviewPlan'
import { REFERENCE } from '../src/LaunchTView/tview'
import stateModelFactory from '../src/TViewPanel/model'

import type { TviewPlanResult } from '../src/LaunchTView/TviewGetPlanRpc/TviewGetPlan'

const session = vi.hoisted(() => ({ current: {} }))

vi.mock('@jbrowse/core/util', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSession: () => session.current,
}))
vi.mock('../src/LaunchTView/fetchTviewPlan', () => ({
  fetchTviewPlan: vi.fn(),
}))

const fetchPlan = vi.mocked(fetchTviewPlan)

/**
 * ctgA:101..110 by hand, 0-based 100..109 = ACGTCAGCAT. Two columns are
 * inserted before 102, and 104..107 (CAGC) is an array block six columns wide
 * in which the reference allele has two gaps. The last block column is a gap in
 * every row, so hiding gappy columns has one to hide.
 */
const REFERENCE_ROW = 'AC--GTCA-GC-AT'
const READ_ROW = 'ACTTGTCAAGC-AT'
const REFERENCE_POS_BY_COLUMN = [
  100, 101, 102, 102, 102, 103, 104, 105, 106, 106, 107, 108, 108, 109,
]

function handBuilt(overrides: Partial<TviewPlanResult> = {}): TviewPlanResult {
  return {
    msa: `>${REFERENCE}\n${REFERENCE_ROW}\n>read\n${READ_ROW}\n`,
    rowData: {
      [REFERENCE]: { sample: REFERENCE, copies: 4 },
      read: { sample: 'HG002', copies: 5 },
    },
    highlights: [
      { start: 3, end: 4, label: '+2bp after ctgA:102', mark: 'bracket' },
      {
        start: 7,
        end: 12,
        label: '(CAGC)x1 in the reference',
        mark: 'bracket',
      },
    ],
    rowCount: 2,
    columnCount: REFERENCE_ROW.length,
    cellCount: 2 * REFERENCE_ROW.length,
    region: { refName: 'ctgA', start: 100, end: 110 },
    arrays: [],
    subjectIndex: 0,
    referenceName: REFERENCE,
    samples: ['HG002'],
    ...overrides,
  }
}

const hovered = observable.box<unknown>(undefined)

function view(snapshot: Record<string, unknown> = {}) {
  return stateModelFactory().create({
    type: 'TView',
    id: 'tview1',
    connectedViewId: 'lgv',
    init: { assembly: 'volvox', loc: 'ctgA:101..110', tracks: ['volvox_bam'] },
    ...snapshot,
  })
}

async function loaded(snapshot: Record<string, unknown> = {}) {
  const model = view(snapshot)
  await new Promise(r => setTimeout(r, 0))
  return model
}

beforeEach(() => {
  vi.clearAllMocks()
  hovered.set(undefined)
  session.current = {
    ...fakeSession(['volvox_bam']),
    views: [{ id: 'lgv' }],
    get hovered() {
      return hovered.get()
    },
  }
  fetchPlan.mockResolvedValue(handBuilt())
})

describe('a view from a bare init', () => {
  it('bands rows by sample, the reference first, and orders by copies', async () => {
    const model = await loaded()
    expect(model.rowTransform).toEqual({
      facet: { field: 'sample', sort: [REFERENCE, 'HG002'] },
      sort: [{ field: 'copies', order: 'descending' }],
    })
    expect(model.rowPanels.map(p => p.kind)).toEqual(['bar', 'text'])
    expect(JSON.parse(model.data.treeMetadata!)).toEqual(handBuilt().rowData)
  })

  it('keeps file order and draws no copy panel without a subject array', async () => {
    fetchPlan.mockResolvedValue(handBuilt({ subjectIndex: undefined }))
    const model = await loaded()
    expect(model.rowTransform).toEqual({
      facet: { field: 'sample', sort: [REFERENCE, 'HG002'] },
    })
    expect(model.rowPanels).toHaveLength(0)
  })

  it('reads every row against the reference, in DNA colours', async () => {
    const model = await loaded()
    expect(model.relativeTo).toBe(REFERENCE)
    expect(model.residueColor).toEqual({
      field: 'residue',
      scale: { scheme: 'jbrowse_dna' },
    })
    expect(model.rowHeight).toBe(12)
    expect(model.labelsAlignRight).toBe(true)
  })

  it('fits the column width to the column count', async () => {
    fetchPlan.mockResolvedValue(handBuilt({ columnCount: 600 }))
    expect((await loaded()).colWidth).toBe(5)
  })

  it('keeps a column width the snapshot sets', async () => {
    fetchPlan.mockResolvedValue(handBuilt({ columnCount: 600 }))
    expect((await loaded({ colWidth: 7 })).colWidth).toBe(7)
  })

  it('keeps neither the alignment nor the row table in its snapshot', async () => {
    const snapshot = getSnapshot(await loaded())
    expect(snapshot.data).toEqual({})
    expect(snapshot.init).toBeDefined()
  })
})

describe('the bracket highlights', () => {
  it('replaces the ones a load made and keeps the reader’s own', async () => {
    const own = { start: 1, end: 2, label: 'mine' }
    const model = await loaded({ highlights: [own] })
    expect(model.highlights).toEqual([own, ...handBuilt().highlights])

    const next = handBuilt({
      highlights: [{ start: 5, end: 5, label: 'next', mark: 'bracket' }],
    })
    fetchPlan.mockResolvedValue(next)
    model.setInit({ ...model.init!, loc: 'ctgA:102..111' })
    await new Promise(r => setTimeout(r, 0))
    expect(model.highlights).toEqual([own, ...next.highlights])
  })

  it('does not double the ones a restored snapshot carries', async () => {
    const model = await loaded({ highlights: handBuilt().highlights })
    expect(model.highlights).toEqual(handBuilt().highlights)
  })
})

describe('column to reference position', () => {
  it('reads the reference row, an inserted or gapped column taking the next base', async () => {
    const model = await loaded()
    expect(model.blanks).toEqual([])
    expect(
      REFERENCE_ROW.split('').map((_, col) => model.colToGenomeRegion(col)),
    ).toEqual(
      REFERENCE_POS_BY_COLUMN.map(start => ({
        refName: 'ctgA',
        start,
        end: start + 1,
      })),
    )
  })

  it('counts past hidden gappy columns', async () => {
    const model = await loaded()
    model.setAllowedGappyness(50)
    expect(model.blanks.length).toBeGreaterThan(0)
    const visible = REFERENCE_ROW.length - model.blanks.length
    for (let col = 0; col < visible; col++) {
      const global = model.visibleColToGlobalCol(col)
      expect(model.colToGenomeRegion(col)?.start).toBe(
        REFERENCE_POS_BY_COLUMN[global],
      )
    }
  })
})

describe('the genome hover', () => {
  const genomeHover = (model: ReturnType<typeof view>) =>
    model.transientHighlights['genome-hover']

  it('highlights the hovered base as a residue of the reference row', async () => {
    const model = await loaded()
    hovered.set({ hoverPosition: { refName: 'ctgA', coord: 103 } })
    expect(genomeHover(model)).toEqual([{ row: REFERENCE, start: 3, end: 3 }])
    expect(JSON.stringify(getSnapshot(model))).not.toContain('genome-hover')
  })

  it('clears outside the window, in another view and when the hover goes', async () => {
    const model = await loaded()
    hovered.set({ hoverPosition: { refName: 'ctgA', coord: 103 } })
    hovered.set({ hoverPosition: { refName: 'ctgA', coord: 111 } })
    expect(genomeHover(model)).toBeUndefined()
    hovered.set({ hoverPosition: { refName: 'ctgB', coord: 103 } })
    expect(genomeHover(model)).toBeUndefined()
    hovered.set({ hoverPosition: { refName: 'ctgA', coord: 101 } })
    expect(genomeHover(model)).toHaveLength(1)
    hovered.set({
      hoverPosition: { refName: 'ctgA', coord: 101 },
      viewId: 'another_lgv',
    })
    expect(genomeHover(model)).toBeUndefined()
    hovered.set({
      hoverPosition: { refName: 'ctgA', coord: 101 },
      viewId: 'lgv',
    })
    expect(genomeHover(model)).toHaveLength(1)
    hovered.set(undefined)
    expect(genomeHover(model)).toBeUndefined()
  })

  it('does not move the alignment’s own hovered column', async () => {
    const model = await loaded()
    hovered.set({ hoverPosition: { refName: 'ctgA', coord: 103 } })
    expect(model.mouseCol).toBeUndefined()
    expect(model.connectedHighlights).toEqual([])
  })
})

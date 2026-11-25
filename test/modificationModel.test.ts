import { getSnapshot } from '@jbrowse/mobx-state-tree'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSession } from './fakeSession'
import { fetchTviewPlan } from '../src/LaunchTView/fetchTviewPlan'
import { REFERENCE } from '../src/LaunchTView/tview'
import stateModelFactory from '../src/TViewPanel/model'
import { MODIFICATION_FILL } from '../src/TViewPanel/modifications'

import type { TviewPlanResult } from '../src/LaunchTView/TviewGetPlanRpc/TviewGetPlan'
import type { TviewModifications } from '../src/LaunchTView/modifications'
import type { Encoding } from 'react-msaview'

const session = vi.hoisted(() => ({ current: {} }))

vi.mock('@jbrowse/core/util', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSession: () => session.current,
}))
vi.mock('../src/LaunchTView/fetchTviewPlan', () => ({
  fetchTviewPlan: vi.fn(),
}))

const fetchPlan = vi.mocked(fetchTviewPlan)

const MODIFICATIONS: TviewModifications = {
  rows: ['read'],
  types: ['m', 'a'],
  row: Uint32Array.from([0, 0]),
  residue: Uint32Array.from([2, 4]),
  type: Uint8Array.from([0, 1]),
  prob: Uint8Array.from([222, 12]),
  dropped: 0,
  unplaced: 0,
}

function plan(modifications?: TviewModifications): TviewPlanResult {
  return {
    msa: `>${REFERENCE}\nACGTCA\n>read\nACGTCA\n`,
    rowData: { [REFERENCE]: { sample: REFERENCE }, read: { sample: 'HG002' } },
    highlights: [],
    rowCount: 2,
    columnCount: 6,
    cellCount: 12,
    region: { refName: 'ctgA', start: 100, end: 106 },
    arrays: [],
    referenceName: REFERENCE,
    samples: ['HG002'],
    ...(modifications ? { modifications } : {}),
  }
}

async function loaded() {
  const model = stateModelFactory().create({
    type: 'TView',
    id: 'tview1',
    init: { assembly: 'volvox', loc: 'ctgA:101..106', tracks: ['volvox_bam'] },
  })
  await new Promise(r => setTimeout(r, 0))
  return model
}

type Model = Awaited<ReturnType<typeof loaded>>

function modificationItems(model: Model) {
  const item = model
    .menuItems()
    .find(i => 'label' in i && i.label === 'Base modifications')
  return item && 'subMenu' in item && Array.isArray(item.subMenu)
    ? item.subMenu
    : undefined
}

function click(model: Model, label: string) {
  const item = modificationItems(model)?.find(
    i => 'label' in i && i.label === label,
  )
  if (item && 'onClick' in item) {
    item.onClick()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  session.current = fakeSession(['volvox_bam'])
})

describe('a load whose reads carry base modifications', () => {
  it('draws one annotation per call, named for its type and probability', async () => {
    fetchPlan.mockResolvedValue(plan(MODIFICATIONS))
    const model = await loaded()
    expect(model.annotations).toEqual([
      {
        id: 'read',
        accession: '5mC',
        name: '5mC',
        description: '5mC 87%',
        featureType: 'modified_base',
        start: 2,
        end: 2,
        attributes: { probability: '87' },
      },
      {
        id: 'read',
        accession: '6mA',
        name: '6mA',
        description: '6mA 5%',
        featureType: 'modified_base',
        start: 4,
        end: 4,
        attributes: { probability: '5' },
      },
    ])
    expect(model.encodings).toEqual([MODIFICATION_FILL])
  })

  it('keeps the calls out of the snapshot', async () => {
    fetchPlan.mockResolvedValue(plan(MODIFICATIONS))
    const snapshot = JSON.stringify(getSnapshot(await loaded()))
    expect(snapshot).not.toContain('5mC')
  })

  it('keeps a fill encoding the view already has', async () => {
    fetchPlan.mockResolvedValue(plan(MODIFICATIONS))
    const own: Encoding = { channel: 'featureFill', field: 'name' }
    const model = stateModelFactory().create({
      type: 'TView',
      id: 'tview1',
      init: {
        assembly: 'volvox',
        loc: 'ctgA:101..106',
        tracks: ['volvox_bam'],
      },
      encodings: [own],
    })
    await new Promise(r => setTimeout(r, 0))
    expect(model.encodings).toEqual([own])
  })

  it('colours by bases, and switches to colouring by modification', async () => {
    fetchPlan.mockResolvedValue(plan(MODIFICATIONS))
    const model = await loaded()
    expect(model.residueColor.field).toBe('residue')
    expect(
      modificationItems(model)?.map(i => ('label' in i ? i.label : '')),
    ).toEqual(['Color by bases', 'Color by modification'])
    click(model, 'Color by modification')
    expect(model.resolvedResidueColor.field).toBe('feature')
    expect(model.resolvedResidueColor.scheme).toBe('jbrowse_dna')
    click(model, 'Color by bases')
    expect(model.residueColor).toEqual({
      field: 'residue',
      scale: { scheme: 'jbrowse_dna' },
    })
  })

  it('says how many calls it could not show', async () => {
    fetchPlan.mockResolvedValue(
      plan({ ...MODIFICATIONS, dropped: 1234, unplaced: 1 }),
    )
    const model = await loaded()
    expect(modificationItems(model)?.at(-1)).toEqual({
      type: 'subHeader',
      label:
        '2 calls shown, 1,234 less probable over the 50,000 cap, 1 row not annotated',
    })
  })
})

describe('a load without base modifications', () => {
  it('offers no modification menu and sets no annotations', async () => {
    fetchPlan.mockResolvedValue(plan())
    const model = await loaded()
    expect(modificationItems(model)).toBeUndefined()
    expect(model.annotations).toEqual([])
    expect(model.encodings).toEqual([])
  })
})

import { destroy } from '@jbrowse/mobx-state-tree'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSession } from './fakeSession'
import { fetchTviewPlan } from '../src/LaunchTView/fetchTviewPlan'
import stateModelFactory from '../src/TViewPanel/model'

import type { TviewPlanResult } from '../src/LaunchTView/TviewGetPlanRpc/TviewGetPlan'
import type { TviewInit } from '../src/TViewPanel/init'

const session = vi.hoisted(() => ({ current: {} }))

vi.mock('@jbrowse/core/util', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSession: () => session.current,
}))
vi.mock('../src/LaunchTView/fetchTviewPlan', () => ({
  fetchTviewPlan: vi.fn(),
}))

const fetchPlan = vi.mocked(fetchTviewPlan)

function plan(msa: string): TviewPlanResult {
  return {
    msa,
    rowData: {},
    highlights: [],
    rowCount: 1,
    columnCount: 4,
    cellCount: 4,
    region: { refName: 'ctgA', start: 0, end: 4 },
    arrays: [],
    samples: [],
  }
}

function deferred() {
  let resolve: (value: TviewPlanResult) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<TviewPlanResult>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const init: TviewInit = {
  assembly: 'volvox',
  loc: 'ctgA:1..4',
  tracks: ['volvox_bam'],
}

function view(snapshot: Record<string, unknown> = {}) {
  return stateModelFactory().create({
    type: 'TView',
    id: 'tview1',
    init,
    ...snapshot,
  })
}

const settle = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  session.current = fakeSession(['volvox_bam'])
})

describe('the load state', () => {
  it('loads once, and shows the alignment it got', async () => {
    fetchPlan.mockResolvedValue(plan('>ctgA\nACGT\n'))
    const model = view()
    expect(model.viewState.kind).toBe('loading')
    await settle()
    expect(fetchPlan).toHaveBeenCalledTimes(1)
    expect(fetchPlan.mock.calls[0]![0].region).toEqual({
      assemblyName: 'volvox',
      refName: 'ctgA',
      start: 0,
      end: 4,
    })
    expect(model.viewState.kind).toBe('alignment')
  })

  it('takes an empty alignment as the answer rather than loading again', async () => {
    fetchPlan.mockResolvedValue(plan(''))
    const model = view()
    await settle()
    await settle()
    expect(fetchPlan).toHaveBeenCalledTimes(1)
    expect(model.viewState).toEqual({
      kind: 'notice',
      message: 'The region has no reference sequence or reads',
    })
  })

  it('loads again when setInit names something new', async () => {
    fetchPlan.mockResolvedValue(plan('>ctgA\nACGT\n'))
    const model = view()
    await settle()
    model.setInit({ ...init, loc: 'ctgA:5..8' })
    await settle()
    expect(fetchPlan).toHaveBeenCalledTimes(2)
    expect(fetchPlan.mock.calls[1]![0].region.start).toBe(4)
  })

  it('rebuilds from init even when the snapshot carries an alignment', async () => {
    fetchPlan.mockResolvedValue(plan('>reference\nACGT\n'))
    const model = view({ data: { msa: '>stale\nTTTT\n' } })
    await settle()
    expect(fetchPlan).toHaveBeenCalledTimes(1)
    expect(model.data.msa).toBe('>reference\nACGT\n')
  })

  it('drops a result for an init that has since been replaced', async () => {
    const first = deferred()
    fetchPlan
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(plan('>second\nTTTT\n'))
    const model = view()
    model.setInit({ ...init, loc: 'ctgA:5..8' })
    await settle()
    first.resolve(plan('>first\nAAAA\n'))
    await settle()
    expect(model.data.msa).toBe('>second\nTTTT\n')
  })

  it('drops a superseded load even when the init comes back to it', async () => {
    const first = deferred()
    fetchPlan
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(plan('>third\nGGGG\n'))
    const model = view()
    model.setInit({ ...init, loc: 'ctgA:5..8' })
    model.setInit(init)
    await settle()
    first.reject(new Error('aborted'))
    await settle()
    expect(fetchPlan).toHaveBeenCalledTimes(3)
    expect(model.viewState.kind).toBe('alignment')
    expect(model.data.msa).toBe('>third\nGGGG\n')
  })

  it('reports an alignment over the cell limit', async () => {
    fetchPlan.mockResolvedValue({
      ...plan(''),
      cellCount: 30_000_000,
      tooLarge: true,
    })
    const model = view()
    await settle()
    expect(model.viewState).toMatchObject({
      kind: 'error',
      error: expect.stringMatching(/30,000,000 cells, above the 25,000,000/),
    })
  })

  it('drops a result that arrives after the view was closed', async () => {
    const pending = deferred()
    fetchPlan.mockReturnValueOnce(pending.promise)
    const model = view()
    const signal = fetchPlan.mock.calls[0]![0].signal
    destroy(model)
    expect(signal?.aborted).toBe(true)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pending.reject(new Error('aborted'))
    await settle()
    expect(errors).not.toHaveBeenCalled()
    expect(warnings).not.toHaveBeenCalled()
  })

  it('shows a failure, and retries only when asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchPlan.mockRejectedValueOnce(new Error('worker fell over'))
    const model = view()
    await settle()
    expect(model.viewState).toMatchObject({ kind: 'error', retry: true })
    expect(fetchPlan).toHaveBeenCalledTimes(1)

    fetchPlan.mockResolvedValueOnce(plan('>ctgA\nACGT\n'))
    model.retryLoad()
    await settle()
    expect(fetchPlan).toHaveBeenCalledTimes(2)
    expect(model.viewState.kind).toBe('alignment')
  })
})

describe('an init that cannot load', () => {
  it('names the track ids the session does not have', () => {
    session.current = fakeSession(['volvox_bam'])
    const model = view({
      init: { ...init, tracks: ['volvox_bam', 'nope', { trackId: 'nada' }] },
    })
    expect(model.viewState).toEqual({
      kind: 'error',
      error: 'No track in this session has the id nope, nada',
      retry: false,
    })
    expect(fetchPlan).not.toHaveBeenCalled()
  })

  it('shows an over-wide region without fetching anything', () => {
    const model = view({ init: { ...init, loc: 'ctgA:1..50000' } })
    expect(model.viewState).toMatchObject({
      kind: 'error',
      error: expect.stringMatching(/wider than the 20,000bp limit/),
    })
    expect(fetchPlan).not.toHaveBeenCalled()
  })

  it('shows a malformed loc rather than throwing from the autorun', () => {
    const model = view({ init: { ...init, loc: 'nowhere:1..10' } })
    expect(model.viewState.kind).toBe('error')
    expect(fetchPlan).not.toHaveBeenCalled()
  })

  it('waits on an assembly that has not loaded', () => {
    const model = view({ init: { ...init, assembly: 'hg38' } })
    expect(model.viewState).toEqual({
      kind: 'loading',
      message: 'Waiting for assembly hg38',
    })
  })

  it('never shows the import form', () => {
    expect(view().importForm).toBe(false)
  })
})

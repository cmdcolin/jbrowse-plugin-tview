import { describe, expect, it, vi } from 'vitest'

import { fakeSession } from './fakeSession'
import {
  alignmentsTrackIds,
  launchTView,
  regionLaunch,
} from '../src/LaunchTView/launch'
import {
  CURRENT_REGION_LABEL,
  TRACKS_LABEL,
  atRegion,
  initMenuItems,
  trackChoiceIds,
  withTrack,
} from '../src/TViewPanel/initMenu'

import type { TviewInit } from '../src/TViewPanel/init'
import type { MenuItem } from '@jbrowse/core/ui'

const session = fakeSession(['volvox_bam', 'volvox_bam_again'])

function track(trackId: string, displayType: string) {
  return { configuration: { trackId }, displays: [{ type: displayType }] }
}

function region(start: number, end: number, refName = 'ctgA') {
  return { assemblyName: 'volvox', refName, start, end }
}

const init: TviewInit = {
  assembly: 'volvox',
  loc: 'ctgA:1,001..2,000',
  tracks: ['volvox_bam'],
}

describe('alignmentsTrackIds', () => {
  it('takes every track with an alignments display, in view order', () => {
    expect(
      alignmentsTrackIds([
        track('volvox_bam', 'LinearAlignmentsDisplay'),
        track('genes', 'LinearBasicDisplay'),
        track('volvox_bam_again', 'LinearAlignmentsDisplay'),
      ]),
    ).toEqual(['volvox_bam', 'volvox_bam_again'])
  })
})

describe('regionLaunch', () => {
  it('names one whole-base region as a locstring without its assembly', () => {
    expect(regionLaunch(session, [region(1000, 2000)])).toEqual({
      assembly: 'volvox',
      loc: 'ctgA:1,001..2,000',
    })
  })

  it('refuses a region wider than the limit with checkRegion’s reason', () => {
    expect(regionLaunch(session, [region(0, 30_000)])).toEqual({
      reason: 'Region is 30,000bp, wider than the 20,000bp limit',
    })
  })

  it('refuses nothing in view', () => {
    expect(regionLaunch(session, []).reason).toBe('No region is in view')
  })

  it('refuses a span across two regions', () => {
    expect(
      regionLaunch(session, [region(49_000, 50_001), region(0, 100, 'ctgB')])
        .reason,
    ).toBe('Spans more than one region')
  })

  it('refuses an assembly that is not loaded', () => {
    expect(
      regionLaunch(session, [{ ...region(0, 100), assemblyName: 'hg38' }])
        .reason,
    ).toBe('Assembly hg38 is not loaded')
  })
})

describe('launchTView', () => {
  function capture() {
    const addView = vi.fn()
    return { addView, session: { addView } }
  }

  it('names the view after its locus and connects it', () => {
    const { addView, session } = capture()
    launchTView(session, { ...init, connectedViewId: 'lgv' })
    expect(addView).toHaveBeenCalledWith('TView', {
      type: 'TView',
      displayName: 'ctgA:1,001..2,000',
      connectedViewId: 'lgv',
      init,
    })
  })

  it('lets a spec’s own view props through, a connected view included', () => {
    const { addView, session } = capture()
    launchTView(session, init, { colWidth: 4, connectedViewId: 'other' })
    expect(addView.mock.calls[0]?.[1]).toMatchObject({
      colWidth: 4,
      connectedViewId: 'other',
      displayName: 'ctgA:1,001..2,000',
    })
  })
})

describe('the next init', () => {
  it('appends a track that is ticked', () => {
    expect(withTrack(init, 'volvox_bam_again', true).tracks).toEqual([
      'volvox_bam',
      'volvox_bam_again',
    ])
  })

  it('drops a track that is unticked, whichever way it was written', () => {
    expect(
      withTrack(
        { ...init, tracks: ['a', { trackId: 'b', sample: 'B' }] },
        'b',
        false,
      ).tracks,
    ).toEqual(['a'])
  })

  it('does not add a track twice', () => {
    expect(withTrack(init, 'volvox_bam', true)).toEqual(init)
  })

  it('re-points the locus and keeps the tracks', () => {
    expect(
      atRegion(
        { ...init, tracks: ['a', 'b'] },
        { assembly: 'volvox', loc: 'ctgB:1..100' },
      ),
    ).toEqual({ assembly: 'volvox', loc: 'ctgB:1..100', tracks: ['a', 'b'] })
  })

  it('offers the open tracks, then any the view reads that are not open', () => {
    expect(
      trackChoiceIds({ ...init, tracks: ['closed', 'volvox_bam'] }, [
        'volvox_bam',
        'volvox_bam_again',
      ]),
    ).toEqual(['volvox_bam', 'volvox_bam_again', 'closed'])
  })
})

describe('initMenuItems', () => {
  const choices = [
    { trackId: 'volvox_bam', label: 'one' },
    { trackId: 'volvox_bam_again', label: 'two' },
  ]

  function menu(launch = regionLaunch(session, [region(4000, 5000)])) {
    const setInit = vi.fn()
    const items = initMenuItems({ init, choices, region: launch, setInit })
    const find = (label: string) =>
      items.find(i => 'label' in i && i.label === label)
    return { items, setInit, find }
  }

  function subMenu(item: MenuItem | undefined) {
    return item && 'subMenu' in item && Array.isArray(item.subMenu)
      ? item.subMenu
      : []
  }

  function click(item: MenuItem | undefined) {
    if (item && 'onClick' in item) {
      item.onClick()
    }
  }

  it('ticks the tracks the view reads and keeps the last one ticked', () => {
    const tracks = subMenu(menu().find(TRACKS_LABEL))
    expect(
      tracks.map(t => [
        'label' in t && t.label,
        'checked' in t && t.checked,
        'disabled' in t && t.disabled,
      ]),
    ).toEqual([
      ['one', true, true],
      ['two', false, false],
    ])
  })

  it('adds a track when its box is ticked', () => {
    const { find, setInit } = menu()
    click(subMenu(find(TRACKS_LABEL))[1])
    expect(setInit).toHaveBeenCalledWith({
      ...init,
      tracks: ['volvox_bam', 'volvox_bam_again'],
    })
  })

  it('re-points the view at the connected view’s region', () => {
    const { find, setInit } = menu()
    const item = find(CURRENT_REGION_LABEL)
    expect(item && 'disabled' in item && item.disabled).toBe(false)
    click(item)
    expect(setInit).toHaveBeenCalledWith({ ...init, loc: 'ctgA:4,001..5,000' })
  })

  it('disables the region entry with the reason it cannot launch', () => {
    const { find, setInit } = menu({ reason: 'No connected genome view' })
    const item = find(CURRENT_REGION_LABEL)
    expect(item).toMatchObject({
      disabled: true,
      subLabel: 'No connected genome view',
    })
    click(item)
    expect(setInit).not.toHaveBeenCalled()
  })
})

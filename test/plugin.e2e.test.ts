import { spawn } from 'node:child_process'
import fs from 'node:fs'

import puppeteer from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChildProcess } from 'node:child_process'
import type { Browser, Page } from 'puppeteer'

// public/config.json names the plugin at 9000; another port gets a copy of the
// config that names it there, so two checkouts can run this suite at once
const DEFAULT_PORT = 9000
const PORT = process.env.E2E_PORT ? +process.env.E2E_PORT : DEFAULT_PORT
const CONFIG = PORT === DEFAULT_PORT ? 'config.json' : `config.e2e-${PORT}.json`
const INSTANCE = process.env.TEST_JBROWSE_DIR ?? '.test-jbrowse'
const URL = `http://localhost:${PORT}/${INSTANCE}/index.html?config=../public/${CONFIG}`
const SHOTS = 'test-screenshots'

let browser: Browser
let server: ChildProcess

async function waitForBundle() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/dist/out.js`)
      if (res.ok) {
        return
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('dev server did not serve dist/out.js')
}

beforeAll(async () => {
  if (!fs.existsSync(INSTANCE)) {
    throw new Error(
      `${INSTANCE} missing — run: pnpm dlx @jbrowse/cli create ${INSTANCE} --nightly`,
    )
  }
  fs.mkdirSync(SHOTS, { recursive: true })
  if (PORT !== DEFAULT_PORT) {
    fs.writeFileSync(
      `public/${CONFIG}`,
      fs
        .readFileSync('public/config.json', 'utf8')
        .replaceAll(`localhost:${DEFAULT_PORT}`, `localhost:${PORT}`),
    )
  }
  // serving the plugin bundle and the jbrowse instance from the repo root puts
  // both on one origin, so no cross-origin plugin loading is involved
  server = spawn('node', ['esbuild.mjs', '--watch'], {
    env: { ...process.env, PORT: `${PORT}` },
    stdio: 'ignore',
  })
  await waitForBundle()
  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
}, 180_000)

afterAll(async () => {
  await browser.close()
  server.kill()
})

/**
 * Opens the instance, on the config's defaultSession or on a session spec. A
 * spec view goes through the plugin's LaunchView-TView, which is the path a
 * shared link takes.
 */
async function openJBrowse(specViews?: Record<string, unknown>[]) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  const errors: string[] = []
  const requests: string[] = []
  page.on('pageerror', e => {
    errors.push(e instanceof Error ? e.message : String(e))
  })
  page.on('console', m => {
    if (m.type() === 'error') {
      errors.push(m.text())
    }
  })
  page.on('request', r => {
    requests.push(r.url())
  })
  const session = specViews
    ? `&session=spec-${encodeURIComponent(JSON.stringify({ views: specViews }))}`
    : ''
  await page.goto(`${URL}${session}`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => !!window.JBrowseSession, { timeout: 90_000 })
  return { page, errors, requests }
}

const bamRequests = (requests: string[]) =>
  requests.filter(url => url.includes('volvox-sorted-altname.bam')).length

/** react-msaview's file-import form, which a tview must never show */
const IMPORT_FORM = 'MSA file or URL'

async function tviewText(page: Page) {
  await page.waitForFunction(
    () =>
      window.JBrowseSession.views.find(
        (v: { type: string }) => v.type === 'TView',
      )?.viewState.kind === 'error',
    { timeout: 60_000 },
  )
  return page.evaluate(() => document.body.innerText)
}

/** the session exists before defaultSession's track is instantiated */
async function waitForDisplay(page: Page) {
  await page.waitForFunction(
    () => !!window.JBrowseSession.views[0]?.tracks[0]?.displays[0],
    { timeout: 90_000 },
  )
}

// jbrowse-web publishes these on window for exactly this kind of driving
declare global {
  interface Window {
    JBrowseSession: any
    JBrowseRootModel: any
    JBrowsePluginTView: unknown
    tviewCalls: number
  }
}

/** until the TView has rows to show */
async function waitForTView(page: Page) {
  await page.waitForFunction(
    () =>
      window.JBrowseSession.views.find(
        (v: { type: string }) => v.type === 'TView',
      )?.rows.length > 0,
    { timeout: 60_000 },
  )
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

const TRACK_MENU_LABEL = 'Launch tview for visible region'

/** clicks the alignments track's launch item, which opens the view directly */
async function launchFromTrackMenu(page: Page) {
  await page.evaluate(label => {
    window.JBrowseSession.views[0].tracks[0].displays[0]
      .trackMenuItems()
      .find((i: { label: string }) => i.label === label)
      .onClick()
  }, TRACK_MENU_LABEL)
}

/** the tview's view menu item with this label, or a row of its submenu */
async function clickTViewMenuItem(page: Page, label: string, row?: string) {
  await page.evaluate(
    (label, row) => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      const item = v
        .menuItems()
        .find((i: { label: string }) => i.label === label)
      const target = row
        ? item.subMenu.find((i: { label: string }) => i.label === row)
        : item
      target.onClick()
    },
    label,
    row,
  )
}

describe('dev server', () => {
  // esbuild's serve answers 200 with the whole file when a Range end is past
  // EOF, which BAM readers misparse as "invalid bgzf header"
  it('clamps a range whose end is past EOF instead of returning 200', async () => {
    const url = `http://localhost:${PORT}/public/volvox-sorted-altname.bam`
    const size = fs.statSync('public/volvox-sorted-altname.bam').size
    const res = await fetch(url, {
      headers: { Range: `bytes=262144-${size + 100000}` },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(
      `bytes 262144-${size - 1}/${size}`,
    )
    const got = new Uint8Array(await res.arrayBuffer())
    const want = new Uint8Array(
      fs.readFileSync('public/volvox-sorted-altname.bam'),
    ).subarray(262144)
    expect(got.length).toBe(want.length)
    expect(got.every((b, i) => b === want[i])).toBe(true)
  }, 60_000)
})

describe('tview plugin in jbrowse-web', () => {
  it('loads the UMD bundle and registers the TView view type', async () => {
    const { page, errors } = await openJBrowse()
    const info = await page.evaluate(() => ({
      pluginLoaded: typeof window.JBrowsePluginTView,
      viewTypes: window.JBrowseRootModel.pluginManager
        .getElementTypesInGroup('view')
        .map((v: { name: string }) => v.name),
    }))
    expect(info.pluginLoaded).toBe('object')
    expect(info.viewTypes).toContain('TView')
    // the plugin itself must not throw; upstream data errors are not our concern
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await screenshot(page, '01-loaded')
    await page.close()
  }, 180_000)

  it('adds the launch menu item to the alignments display', async () => {
    const { page } = await openJBrowse()
    await waitForDisplay(page)
    const menu = await page.evaluate(() => {
      const display = window.JBrowseSession.views[0].tracks[0].displays[0]
      return {
        displayType: display.type,
        labels: display.trackMenuItems().map((i: { label: string }) => i.label),
      }
    })
    expect(menu.displayType).toBe('LinearAlignmentsDisplay')
    expect(menu.labels).toContain(TRACK_MENU_LABEL)
    await page.close()
  }, 180_000)

  it('opens a loaded view for the visible region from the track menu, with no dialog', async () => {
    const { page, errors } = await openJBrowse()
    await waitForDisplay(page)
    await launchFromTrackMenu(page)
    await waitForTView(page)
    const state = await page.evaluate(() => {
      const session = window.JBrowseSession
      const lgv = session.views[0]
      const v = session.views.find((x: { type: string }) => x.type === 'TView')
      const [r] = lgv.visibleWholeBaseRegions
      const n = (x: number) => x.toLocaleString('en-US')
      return {
        expectedLoc: `${r.refName}:${n(r.start + 1)}..${n(r.end)}`,
        init: v.init,
        displayName: v.displayName,
        connectedViewId: v.connectedViewId,
        lgvId: lgv.id,
        state: v.viewState.kind,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
      }
    })
    expect(state.expectedLoc).toMatch(/^ctgA:1,000\.\./)
    expect(state.init).toEqual({
      assembly: 'volvox',
      loc: state.expectedLoc,
      tracks: ['volvox_bam'],
    })
    expect(state.displayName).toBe(state.expectedLoc)
    expect(state.connectedViewId).toBe(state.lgvId)
    expect(state.state).toBe('alignment')
    expect(state.dialogs).toBe(0)
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await screenshot(page, '02-track-menu-launch')
    await page.close()
  }, 180_000)

  it('disables the track menu item, saying why, when zoomed out past the limit', async () => {
    const { page } = await openJBrowse()
    await waitForDisplay(page)
    await page.evaluate(async () => {
      await window.JBrowseSession.views[0].navToLocString(
        'ctgA:1..40000',
        'volvox',
      )
    })
    const item = await page.evaluate(label => {
      const { disabled, subLabel } =
        window.JBrowseSession.views[0].tracks[0].displays[0]
          .trackMenuItems()
          .find((i: { label: string }) => i.label === label)
      return { disabled, subLabel }
    }, TRACK_MENU_LABEL)
    expect(item.disabled).toBe(true)
    expect(item.subLabel).toMatch(
      /^Region is [\d,]+bp, wider than the 20,000bp limit$/,
    )
    await page.close()
  }, 180_000)

  it('launches over a dragged-out region with every open alignments track', async () => {
    const { page, errors } = await openJBrowse()
    await waitForDisplay(page)
    await page.evaluate(async () => {
      const lgv = window.JBrowseSession.views[0]
      lgv.showTrack('volvox_bam_again')
      await lgv.navToLocString('ctgA:7500..7700', 'volvox')
    })
    await page.waitForFunction(
      () => !!window.JBrowseSession.views[0].tracks[1]?.displays[0],
      { timeout: 90_000 },
    )
    const drag = await page.evaluate(() => {
      const lgv = window.JBrowseSession.views[0]
      const box = document
        .querySelector(
          `[data-testid="linear-genome-view-${lgv.id}"] [data-testid="rubberband_controls"]`,
        )!
        .getBoundingClientRect()
      const x = (coord: number) =>
        box.left +
        lgv.bpToPx({ refName: 'ctgA', coord }).offsetPx -
        lgv.offsetPx
      return { from: x(7560), to: x(7650), y: box.top + box.height / 2 }
    })
    await page.mouse.move(drag.from, drag.y)
    await page.mouse.down()
    await page.mouse.move((drag.from + drag.to) / 2, drag.y, { steps: 5 })
    await page.mouse.move(drag.to, drag.y, { steps: 5 })
    await page.mouse.up()

    const menuItem = (text: string) =>
      page.waitForFunction(
        t =>
          [...document.querySelectorAll('[role="menuitem"]')].find(
            el => el.textContent.trim() === t,
          ),
        { timeout: 30_000 },
        text,
      )
    const launch = await menuItem('Launch')
    await launch.asElement()!.hover()
    const entry = await menuItem('Tview of all alignments tracks')
    await entry.asElement()!.click()
    await waitForTView(page)

    const state = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      return {
        init: v.init,
        displayName: v.displayName,
        loadedRegion: v.loadedRegion,
        bands: v.facetClades.map((c: { label?: string }) => c.label),
      }
    })
    expect(state.init.tracks).toEqual(['volvox_bam', 'volvox_bam_again'])
    expect(state.displayName).toBe(state.init.loc)
    expect(state.loadedRegion.refName).toBe('ctgA')
    expect(Math.abs(state.loadedRegion.start - 7559)).toBeLessThanOrEqual(3)
    expect(Math.abs(state.loadedRegion.end - 7650)).toBeLessThanOrEqual(3)
    expect(state.bands).toEqual([
      'reference',
      'volvox-sorted.bam',
      'volvox-sorted.bam again',
    ])
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await screenshot(page, '09-rubberband-launch')
    await page.close()
  }, 180_000)

  it('adds a second sample band from the view menu’s Tracks submenu', async () => {
    const { page, errors } = await openJBrowse()
    await waitForDisplay(page)
    await page.evaluate(() => {
      window.JBrowseSession.views[0].showTrack('volvox_bam_again')
    })
    await launchFromTrackMenu(page)
    await waitForTView(page)
    const before = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      const tracks = v
        .menuItems()
        .find((i: { label: string }) => i.label === 'Tracks')
        .subMenu.map(
          (i: { label: string; checked: boolean; disabled: boolean }) => [
            i.label,
            i.checked,
            i.disabled,
          ],
        )
      return { tracks, bands: v.facetClades.length }
    })
    expect(before.tracks).toEqual([
      ['volvox-sorted.bam', true, true],
      ['volvox-sorted.bam again', false, false],
    ])
    await clickTViewMenuItem(page, 'Tracks', 'volvox-sorted.bam again')
    await page.waitForFunction(
      () =>
        window.JBrowseSession.views.find(
          (x: { type: string }) => x.type === 'TView',
        )?.facetClades.length === 3,
      { timeout: 60_000 },
    )
    const after = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      return {
        tracks: v.init.tracks,
        bands: v.facetClades.map((c: { label?: string }) => c.label),
      }
    })
    expect(after.tracks).toEqual(['volvox_bam', 'volvox_bam_again'])
    expect(after.bands).toEqual([
      'reference',
      'volvox-sorted.bam',
      'volvox-sorted.bam again',
    ])
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await page.close()
  }, 180_000)

  it('re-points the view at the genome view’s region from its menu', async () => {
    const { page, errors } = await openJBrowse()
    await waitForDisplay(page)
    await launchFromTrackMenu(page)
    await waitForTView(page)
    await page.evaluate(async () => {
      await window.JBrowseSession.views[0].navToLocString(
        'ctgA:15100..15250',
        'volvox',
      )
    })
    await clickTViewMenuItem(page, "Show the connected view's current region")
    await page.waitForFunction(
      () =>
        window.JBrowseSession.views.find(
          (x: { type: string }) => x.type === 'TView',
        )?.loadedRegion?.start > 15000,
      { timeout: 60_000 },
    )
    const state = await page.evaluate(() => {
      const session = window.JBrowseSession
      const v = session.views.find((x: { type: string }) => x.type === 'TView')
      const [r] = session.views[0].visibleWholeBaseRegions
      return {
        loadedRegion: v.loadedRegion,
        visible: { refName: r.refName, start: r.start, end: r.end },
        tracks: v.init.tracks,
        state: v.viewState.kind,
      }
    })
    expect(state.loadedRegion).toEqual(state.visible)
    expect(state.tracks).toEqual(['volvox_bam'])
    expect(state.state).toBe('alignment')

    await page.evaluate(async () => {
      await window.JBrowseSession.views[0].navToLocString(
        'ctgA:1..40000',
        'volvox',
      )
    })
    const disabled = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      const { disabled, subLabel } = v
        .menuItems()
        .find(
          (i: { label: string }) =>
            i.label === "Show the connected view's current region",
        )
      return { disabled, subLabel }
    })
    expect(disabled.disabled).toBe(true)
    expect(disabled.subLabel).toMatch(/wider than the 20,000bp limit/)
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await page.close()
  }, 180_000)

  it('rebuilds the same view when a session is restored', async () => {
    const { page, errors } = await openJBrowse()
    await waitForDisplay(page)
    await page.evaluate(async () => {
      await window.JBrowseSession.views[0].navToLocString(
        'ctgA:1..2000',
        'volvox',
      )
    })
    await launchFromTrackMenu(page)
    await waitForTView(page)

    const built = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      const snapshot = JSON.parse(JSON.stringify(v))
      return {
        look: {
          msaChars: v.data.msa.length,
          rowData: v.data.treeMetadata,
          rows: v.rows.length,
          numColumns: v.numColumns,
          rowTransform: v.rowTransform,
          rowPanels: v.rowPanels,
          highlights: v.highlights,
          relativeTo: v.relativeTo,
          residueColor: v.residueColor,
          colWidth: v.colWidth,
          rowHeight: v.rowHeight,
        },
        snapshot,
      }
    })
    // nothing derived is kept: the alignment and the row table are rebuilt
    expect(built.snapshot.data).toEqual({})
    expect(built.look.msaChars).toBeGreaterThan(0)
    expect(built.snapshot.init.assembly).toBe('volvox')
    // the end depends on how the view snapped bp to the pixel grid
    expect(built.snapshot.init.loc).toMatch(/ctgA:1\.\./)
    expect(built.snapshot.init.tracks).toEqual(['volvox_bam'])
    expect(built.snapshot.displayName).toBe(built.snapshot.init.loc)

    // recreating the view from that snapshot is what a reload does to it
    const rowsImmediately = await page.evaluate(snapshot => {
      const session = window.JBrowseSession
      for (const v of session.views.filter(
        (x: { type: string }) => x.type === 'TView',
      )) {
        session.removeView(v)
      }
      return session.addView('TView', { ...snapshot, id: undefined }).rows
        .length
    }, built.snapshot)
    expect(rowsImmediately).toBe(0)

    await waitForTView(page)
    const restored = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      return {
        look: {
          msaChars: v.data.msa.length,
          rowData: v.data.treeMetadata,
          rows: v.rows.length,
          numColumns: v.numColumns,
          rowTransform: v.rowTransform,
          rowPanels: v.rowPanels,
          highlights: v.highlights,
          relativeTo: v.relativeTo,
          residueColor: v.residueColor,
          colWidth: v.colWidth,
          rowHeight: v.rowHeight,
        },
        state: v.viewState.kind,
        colMapsTo: v.colToGenomeRegion(10),
      }
    })
    expect(restored.state).toBe('alignment')
    expect(restored.look).toEqual(built.look)
    expect(restored.look.numColumns).toBe(2000)
    expect(restored.colMapsTo).toEqual({ refName: 'ctgA', start: 10, end: 11 })
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await page.close()
  }, 180_000)

  it('builds a tview from real BAM reads, bracketing the insertion', async () => {
    const { page, errors } = await openJBrowse()
    await waitForDisplay(page)
    // 19 reads carry a 1bp insertion at ctgA:15163 while others span it without
    await page.evaluate(async () => {
      await window.JBrowseSession.views[0].navToLocString(
        'ctgA:15100..15250',
        'volvox',
      )
    })
    await launchFromTrackMenu(page)
    await waitForTView(page)

    const tv = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      const site = v.highlights.find(
        (h: { label: string }) => h.label === '+1bp after ctgA:15,163',
      )
      const insCol = site.start - 1
      const counts: Record<string, number> = {}
      for (const r of v.rows) {
        const c = r[1][insCol]
        counts[c] = (counts[c] ?? 0) + 1
      }
      return {
        rows: v.rows.length,
        distinctRowLengths: new Set(v.rows.map((r: string[]) => r[1]?.length))
          .size,
        site,
        countsAtInsertionColumn: counts,
        insertionColumnMapsTo: v.colToGenomeRegion(insCol),
      }
    })

    expect(tv.rows).toBeGreaterThan(0)
    // the invariant that makes tview readable
    expect(tv.distinctRowLengths).toBe(1)
    expect(tv.site).toMatchObject({ end: tv.site.start, mark: 'bracket' })
    // reads with the insertion show a base, one spanning read shows a gap
    const bases = Object.entries(tv.countsAtInsertionColumn)
      .filter(([c]) => /[ACGT]/.test(c))
      .reduce((a, [, n]) => a + n, 0)
    expect(bases).toBe(19)
    expect(tv.countsAtInsertionColumn['-'] ?? 0).toBeGreaterThan(0)
    // an insertion column is read against the reference base after it
    expect(tv.insertionColumnMapsTo).toEqual({
      refName: 'ctgA',
      start: 15163,
      end: 15164,
    })
    expect(errors.filter(e => /bgzf|TView|tview/i.test(e))).toEqual([])
    await screenshot(page, '04-real-bam')
    await page.close()
  }, 180_000)

  it('gives a view from a bare init the reference, the brackets and the DNA colours', async () => {
    const { page, errors } = await openJBrowse([
      {
        type: 'TView',
        assembly: 'volvox',
        loc: 'ctgA:15100..15250',
        tracks: ['volvox_bam'],
      },
    ])
    await waitForTView(page)
    const state = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      return {
        displayName: v.displayName,
        firstRow: v.rowNames[0],
        relativeTo: v.relativeTo,
        tracks: v.turnedOnTracks.map(
          (t: { model: { id: string } }) => t.model.id,
        ),
        brackets: v.highlights.filter(
          (h: { mark?: string }) => h.mark === 'bracket',
        ).length,
        residueColor: v.residueColor,
        colWidth: v.colWidth,
        rowTransform: v.rowTransform,
        bands: v.facetClades.map((c: { label?: string }) => c.label),
        // the view hamburger renders menuItems(); react-msaview's
        // extraViewMenuItems() has no caller, so an override there is invisible
        menuLabels: v.menuItems().map((i: { label: string }) => i.label),
      }
    })
    expect(state.displayName).toBe('ctgA:15100..15250')
    expect(state.firstRow).toBe('reference')
    expect(state.relativeTo).toBe('reference')
    expect(state.tracks).toContain('reference-row')
    expect(state.tracks).toContain('highlight-brackets')
    expect(state.brackets).toBeGreaterThan(0)
    expect(state.residueColor).toEqual({
      field: 'residue',
      scale: { scheme: 'jbrowse_dna' },
    })
    expect(state.colWidth).toBe(10)
    expect(state.rowTransform).toEqual({
      facet: { field: 'sample', sort: ['reference', 'volvox-sorted.bam'] },
    })
    expect(state.bands).toEqual(['reference', 'volvox-sorted.bam'])
    expect(state.menuLabels).toContain('Zoom to base level on click?')

    // the jbrowse_dna scheme colors A/C/G/T differently, so a painted alignment
    // shows several distinct colors; a blank canvas would show one
    await page.waitForFunction(
      () => document.querySelectorAll('canvas').length > 0,
      { timeout: 60_000 },
    )
    const colors = await page.evaluate(() => {
      const seen = new Set<string>()
      for (const c of document.querySelectorAll('canvas')) {
        const ctx = c.getContext('2d')
        if (ctx && c.width && c.height) {
          const { data } = ctx.getImageData(0, 0, c.width, c.height)
          for (let i = 0; i < data.length; i += 4) {
            seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
          }
        }
      }
      return seen.size
    })
    expect(colors).toBeGreaterThan(3)
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await screenshot(page, '03-bare-init')
    await page.close()
  }, 180_000)

  it('ties columns and genome positions together both ways', async () => {
    const { page, errors } = await openJBrowse()
    await waitForDisplay(page)
    await page.evaluate(() => {
      const session = window.JBrowseSession
      session.addView('TView', {
        type: 'TView',
        init: {
          assembly: 'volvox',
          loc: 'ctgA:15100..15250',
          tracks: ['volvox_bam'],
        },
        connectedViewId: session.views[0].id,
      })
    })
    await waitForTView(page)

    // hovering the alignment's insertion column bands the base after it
    const hovered = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      const site = v.highlights.find(
        (h: { label: string }) => h.label === '+1bp after ctgA:15,163',
      )
      v.setMousePos(site.start - 1, 1)
      return v.connectedHighlights
    })
    expect(hovered).toEqual([{ refName: 'ctgA', start: 15163, end: 15164 }])
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('div')].some(
          d => getComputedStyle(d).backgroundColor === 'rgba(255, 255, 0, 0.2)',
        ),
      { timeout: 30_000 },
    )

    // clicking a column centers the genome view on its base
    const centered = await page.evaluate(async () => {
      const session = window.JBrowseSession
      const lgv = session.views[0]
      const v = session.views.find((x: { type: string }) => x.type === 'TView')
      v.setMousePos(undefined)
      const target = v.colToGenomeRegion(40)
      v.setMouseClickPos(40, 1)
      await new Promise(r => setTimeout(r, 300))
      return { target, center: lgv.pxToBp(lgv.width / 2) }
    })
    expect(centered.center.refName).toBe('ctgA')
    expect(
      Math.abs(centered.center.coord - 1 - centered.target.start),
    ).toBeLessThanOrEqual(1)

    // hovering a base of the genome view highlights its column
    const at = await page.evaluate(() => {
      const lgv = window.JBrowseSession.views[0]
      const el = document.querySelector(
        `[data-testid="linear-genome-view-${lgv.id}"] [data-testid="tracksContainer"]`,
      )!
      const box = el.getBoundingClientRect()
      const container = document
        .querySelector(`[data-testid="linear-genome-view-${lgv.id}"]`)!
        .getBoundingClientRect()
      const px = lgv.bpToPx({ refName: 'ctgA', coord: 15180.5 })
      return {
        x: container.left + px.offsetPx - lgv.offsetPx,
        y: box.top + box.height / 2,
      }
    })
    await page.mouse.move(at.x, at.y)
    await page.waitForFunction(
      () =>
        window.JBrowseSession.views.find(
          (x: { type: string }) => x.type === 'TView',
        ).transientHighlights['genome-hover'] !== undefined,
      { timeout: 10_000 },
    )
    const genomeHover = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      const band = v.resolvedHighlights.find(
        (h: { transient: boolean }) => h.transient,
      )
      return {
        hovered: window.JBrowseSession.hovered.hoverPosition,
        highlight: v.transientHighlights['genome-hover'],
        column: band.startCol,
        columnMapsTo: v.colToGenomeRegion(band.startCol),
        mouseCol: v.mouseCol,
      }
    })
    const coord = Math.floor(genomeHover.hovered.coord)
    expect(genomeHover.highlight).toEqual([
      { row: 'reference', start: coord - 15099, end: coord - 15099 },
    ])
    expect(genomeHover.columnMapsTo).toEqual({
      refName: 'ctgA',
      start: coord - 1,
      end: coord,
    })
    // the alignment's own cursor stays put, or it would echo back
    expect(genomeHover.mouseCol).toBeUndefined()

    await page.mouse.move(5, 5)
    await page.waitForFunction(
      () =>
        window.JBrowseSession.views.find(
          (x: { type: string }) => x.type === 'TView',
        ).transientHighlights['genome-hover'] === undefined,
      { timeout: 10_000 },
    )
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await page.close()
  }, 180_000)

  it('bands two samples and orders a tandem array by copies', async () => {
    const { page, errors } = await openJBrowse([
      {
        type: 'TView',
        assembly: 'volvox',
        loc: 'ctgA:7560..7650',
        tracks: [
          'volvox_bam',
          { trackId: 'volvox_bam_again', sample: 'HG002 (again)' },
        ],
      },
    ])
    await waitForTView(page)
    const state = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      return {
        bands: v.facetClades.map((c: { label?: string }) => c.label),
        rowTransform: v.rowTransform,
        panels: v.rowPanels.map((p: { kind: string }) => p.kind),
        rows: v.rowNames.length,
        uniqueRows: new Set(v.rowNames).size,
        arrayBracket: v.highlights.find((h: { label: string }) =>
          h.label.endsWith(' in the reference'),
        )?.label,
      }
    })
    expect(state.bands).toEqual([
      'reference',
      'volvox-sorted.bam',
      'HG002 (again)',
    ])
    expect(state.rowTransform.sort).toEqual([
      { field: 'copies', order: 'descending' },
    ])
    expect(state.panels).toEqual(['bar', 'text'])
    // the same reads arrive from both tracks, and every one keeps its row
    expect(state.uniqueRows).toBe(state.rows)
    expect(state.arrayBracket).toMatch(/^\(AATG\)x\d+ in the reference$/)
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])

    // tall enough for both bands, so the figure shows what is being tested
    const height = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      v.setHeight(v.rowNames.length * v.rowHeight + 300)
      return v.height
    })
    await page.setViewport({ width: 1400, height: height + 200 })
    await new Promise(r => setTimeout(r, 500))
    await screenshot(page, '08-two-samples-array')
    await page.close()
  }, 180_000)

  it('names a spec track id that does not exist, instead of the import form', async () => {
    const { page, requests } = await openJBrowse([
      {
        type: 'TView',
        assembly: 'volvox',
        loc: 'ctgA:1000..1100',
        tracks: ['volvox_bam', 'no_such_track'],
      },
    ])
    const text = await tviewText(page)
    expect(text).toContain('No track in this session has the id no_such_track')
    expect(text).not.toContain(IMPORT_FORM)
    const loadState = await page.evaluate(
      () =>
        window.JBrowseSession.views.find(
          (v: { type: string }) => v.type === 'TView',
        ).loadState,
    )
    expect(loadState).toBeUndefined()
    expect(bamRequests(requests)).toBe(0)
    await screenshot(page, '05-missing-track')
    await page.close()
  }, 180_000)

  it('refuses an over-wide spec loc before any reads are fetched', async () => {
    const { page, requests } = await openJBrowse([
      {
        type: 'TView',
        assembly: 'volvox',
        loc: 'ctgA:1..40000',
        tracks: ['volvox_bam'],
      },
    ])
    const text = await tviewText(page)
    expect(text).toContain('Region is 40,000bp, wider than the 20,000bp limit')
    expect(text).not.toContain(IMPORT_FORM)
    const loadState = await page.evaluate(
      () =>
        window.JBrowseSession.views.find(
          (v: { type: string }) => v.type === 'TView',
        ).loadState,
    )
    expect(loadState).toBeUndefined()
    expect(bamRequests(requests)).toBe(0)
    await screenshot(page, '06-too-wide')
    await page.close()
  }, 180_000)

  // ctgB has no reads in this BAM and is 6,079bp, so this loc both runs off the
  // end of the contig and yields no read rows. It used to drop the reference
  // row for being short, leave the alignment empty, and refetch forever.
  it('draws the reference alone over a readless region, and loads once', async () => {
    const { page, errors, requests } = await openJBrowse([
      {
        type: 'TView',
        assembly: 'volvox',
        loc: 'ctgB:6001..7000',
        tracks: ['volvox_bam'],
      },
    ])
    await waitForTView(page)
    const before = await page.evaluate(() => {
      const session = window.JBrowseSession
      const v = session.views.find((x: { type: string }) => x.type === 'TView')
      window.tviewCalls = 0
      const { rpcManager } = session
      const call = rpcManager.call.bind(rpcManager)
      rpcManager.call = (id: string, name: string, args: unknown) => {
        if (name === 'TviewGetPlan') {
          window.tviewCalls++
        }
        return call(id, name, args)
      }
      return {
        rows: v.rows.map((r: string[]) => [r[0], r[1]?.length]),
        loadedRegion: v.loadedRegion,
        state: v.viewState.kind,
      }
    })
    expect(before.rows).toEqual([['reference', 79]])
    expect(before.loadedRegion).toEqual({
      refName: 'ctgB',
      start: 6000,
      end: 6079,
    })
    expect(before.state).toBe('alignment')
    // the request listener does see the worker's fetches, so a zero below is
    // not a listener that hears nothing
    const fetched = bamRequests(requests)
    expect(fetched).toBeGreaterThan(0)

    await new Promise(r => setTimeout(r, 3000))
    const calls = await page.evaluate(() => window.tviewCalls)
    expect(calls).toBe(0)
    expect(bamRequests(requests)).toBe(fetched)
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(
      IMPORT_FORM,
    )
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await screenshot(page, '07-reference-only')
    await page.close()
  }, 180_000)
})

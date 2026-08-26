import { spawn } from 'node:child_process'
import fs from 'node:fs'

import puppeteer from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChildProcess } from 'node:child_process'
import type { Browser, Page } from 'puppeteer'

// must match the plugin url in public/config.json
const PORT = 9000
const INSTANCE = process.env.TEST_JBROWSE_DIR ?? '.test-jbrowse'
const URL = `http://localhost:${PORT}/${INSTANCE}/index.html?config=../public/config.json`
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

async function openJBrowse() {
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  const errors: string[] = []
  page.on('pageerror', e => {
    errors.push(e instanceof Error ? e.message : String(e))
  })
  page.on('console', m => {
    if (m.type() === 'error') {
      errors.push(m.text())
    }
  })
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => !!window.JBrowseSession, { timeout: 90_000 })
  return { page, errors }
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
  }
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/**
 * Submits the launch dialog, once its preview has resolved.
 *
 * Waiting on the button is waiting on the condition itself — Submit is disabled
 * until the plan comes back — where waiting on the sentence beside it waits on
 * the dialog's wording. That sentence was reworded, and these two tests then
 * spent sixty seconds each looking for a phrase nothing prints any more.
 */
async function submitDialog(page: Page) {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some(
        b => b.textContent.trim() === 'Submit' && !b.disabled,
      ),
    { timeout: 60_000 },
  )
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Submit')
      ?.click()
  })
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
    expect(menu.labels).toContain('Launch tview for visible region')
    await page.close()
  }, 180_000)

  it('opens the launch dialog for the visible region', async () => {
    const { page } = await openJBrowse()
    await waitForDisplay(page)
    await page.evaluate(() => {
      const display = window.JBrowseSession.views[0].tracks[0].displays[0]
      display
        .trackMenuItems()
        .find(
          (i: { label: string }) =>
            i.label === 'Launch tview for visible region',
        )
        .onClick()
    })
    await page.waitForFunction(
      () => /samtools tview/i.test(document.body.innerText),
      { timeout: 30_000 },
    )
    // the exact end depends on how the view snaps bp to the pixel grid, so
    // derive it the way the dialog does rather than pinning a literal
    const { text, expected } = await page.evaluate(() => {
      const b = window.JBrowseSession.views[0].dynamicBlocks.contentBlocks[0]
      const n = (x: number) => x.toLocaleString('en-US')
      return {
        text: document.body.innerText,
        expected: `${b.refName}:${n(Math.floor(b.start) + 1)}..${n(Math.ceil(b.end))}`,
      }
    })
    expect(expected).toMatch(/^ctgA:1,000\.\./)
    expect(text).toContain(expected)
    await screenshot(page, '02-dialog')
    await page.close()
  }, 180_000)

  it('rebuilds the alignment when a restored session drops it', async () => {
    const { page, errors } = await openJBrowse()
    await waitForDisplay(page)
    // react-msaview's DataModel strips data.msa from snapshots over 50kb,
    // because it expects an msaFilehandle to reload from. tview has none, so
    // the view has to rebuild the alignment off its persisted `init`.
    await page.evaluate(async () => {
      await window.JBrowseSession.views[0].navToLocString(
        'ctgA:1..2000',
        'volvox',
      )
    })
    await page.evaluate(() => {
      window.JBrowseSession.views[0].tracks[0].displays[0]
        .trackMenuItems()
        .find(
          (i: { label: string }) =>
            i.label === 'Launch tview for visible region',
        )
        .onClick()
    })
    await submitDialog(page)
    await page.waitForFunction(
      () =>
        window.JBrowseSession.views.find(
          (v: { type: string }) => v.type === 'TView',
        )?.rows.length > 0,
      { timeout: 60_000 },
    )

    const built = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      return {
        msaChars: v.data.msa.length,
        rows: v.rows.length,
        init: v.init,
        msaSurvivesSnapshot:
          JSON.parse(JSON.stringify(v)).data.msa !== undefined,
        snapshot: JSON.parse(JSON.stringify(v)),
      }
    })
    // the premise: this alignment is past the cap, so the snapshot loses it
    expect(built.msaChars).toBeGreaterThan(50_000)
    expect(built.msaSurvivesSnapshot).toBe(false)
    // the blob is the whole durable statement of what the view is, so it is
    // what has to survive a snapshot the alignment does not
    expect(built.init.assembly).toBe('volvox')
    // the end depends on how the view snapped bp to the pixel grid, as above
    expect(built.init.loc).toMatch(/ctgA:1\.\./)
    expect(built.init.tracks).toEqual([
      { trackId: 'volvox_bam', sample: 'volvox-sorted.bam' },
    ])

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

    await page.waitForFunction(
      () =>
        window.JBrowseSession.views.find(
          (v: { type: string }) => v.type === 'TView',
        )?.rows.length > 0,
      { timeout: 60_000 },
    )
    const restored = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      return {
        rows: v.rows.length,
        msaChars: v.data.msa.length,
        numColumns: v.numColumns,
        loadFailed: v.loadFailed,
        colMapsTo: v.colToGenomeRegion(10),
      }
    })
    expect(restored.loadFailed).toBe(false)
    expect(restored.rows).toBe(built.rows)
    expect(restored.msaChars).toBe(built.msaChars)
    expect(restored.numColumns).toBe(2000)
    expect(restored.colMapsTo).toEqual({ refName: 'ctgA', start: 10, end: 11 })
    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await page.close()
  }, 180_000)

  it('builds a tview from real BAM reads, expanding insertions', async () => {
    const { page, errors } = await openJBrowse()
    await waitForDisplay(page)
    // 19 reads carry a 1bp insertion at ctgA:15163 while others span it without
    await page.evaluate(async () => {
      await window.JBrowseSession.views[0].navToLocString(
        'ctgA:15100..15250',
        'volvox',
      )
    })
    await page.evaluate(() => {
      window.JBrowseSession.views[0].tracks[0].displays[0]
        .trackMenuItems()
        .find(
          (i: { label: string }) =>
            i.label === 'Launch tview for visible region',
        )
        .onClick()
    })
    await submitDialog(page)
    await page.waitForFunction(
      () =>
        window.JBrowseSession.views.find(
          (v: { type: string }) => v.type === 'TView',
        )?.rows.length > 0,
      { timeout: 60_000 },
    )

    const tv = await page.evaluate(() => {
      const v = window.JBrowseSession.views.find(
        (x: { type: string }) => x.type === 'TView',
      )
      const insCol = v.columnToRefPos.indexOf(15163)
      const counts: Record<string, number> = {}
      for (const r of v.rows) {
        const c = r[1][insCol]
        counts[c] = (counts[c] ?? 0) + 1
      }
      return {
        rows: v.rows.length,
        distinctRowLengths: new Set(v.rows.map((r: string[]) => r[1]?.length))
          .size,
        insertionWidths: v.insertionWidths,
        countsAtInsertionColumn: counts,
        insertionColumnMapsTo: v.colToGenomeRegion(insCol),
      }
    })

    expect(tv.rows).toBeGreaterThan(0)
    // the invariant that makes tview readable
    expect(tv.distinctRowLengths).toBe(1)
    expect(tv.insertionWidths).toContainEqual([15163, 1])
    // reads with the insertion show a base, one spanning read shows a gap
    const bases = Object.entries(tv.countsAtInsertionColumn)
      .filter(([c]) => /[ACGT]/.test(c))
      .reduce((a, [, n]) => a + n, 0)
    expect(bases).toBe(19)
    expect(tv.countsAtInsertionColumn['-'] ?? 0).toBeGreaterThan(0)
    expect(tv.insertionColumnMapsTo).toEqual({
      refName: 'ctgA',
      start: 15163,
      end: 15164,
    })
    expect(errors.filter(e => /bgzf|TView|tview/i.test(e))).toEqual([])
    await screenshot(page, '04-real-bam')
    await page.close()
  }, 180_000)

  it('renders a TView and maps columns back to genome positions', async () => {
    const { page, errors } = await openJBrowse()
    const canvasesBefore = await page.evaluate(
      () => document.querySelectorAll('canvas').length,
    )
    const state = await page.evaluate(() => {
      const session = window.JBrowseSession
      // r2/r3 pad a 3bp insertion that only r1 carries
      const msa = ['>r1', 'AAAGGGCCC', '>r2', 'AAAT--CCC', '>r3', 'AAA---CCC']
        .join('\n')
        .concat('\n')
      session.addView('TView', {
        type: 'TView',
        displayName: 'tview test',
        colWidth: 20,
        rowHeight: 20,
        labelsAlignRight: true,
        colorSchemeName: 'jbrowse_dna',
        connectedViewId: session.views[0].id,
        msaRegion: { refName: 'ctgA', start: 0, end: 6 },
        insertionWidths: [[3, 3]],
        data: { msa },
      })
      const v = session.views.find((x: { type: string }) => x.type === 'TView')
      return {
        rowNames: v.rows.map((r: string[]) => r[0]),
        numColumns: v.numColumns,
        columnToRefPos: v.columnToRefPos,
        insertionColumnRegion: v.colToGenomeRegion(4),
        connectedViewFound: !!v.connectedView,
        // the view hamburger renders menuItems(); react-msaview's
        // extraViewMenuItems() has no caller, so an override there is invisible
        menuLabels: v.menuItems().map((i: { label: string }) => i.label),
      }
    })
    expect(state.menuLabels).toContain('Zoom to base level on click?')
    expect(state.rowNames).toEqual(['r1', 'r2', 'r3'])
    expect(state.numColumns).toBe(9)
    expect(state.columnToRefPos).toEqual([0, 1, 2, 3, 3, 3, 3, 4, 5])
    // column 4 is an insertion column, so it resolves to the position it precedes
    expect(state.insertionColumnRegion).toEqual({
      refName: 'ctgA',
      start: 3,
      end: 4,
    })
    expect(state.connectedViewFound).toBe(true)

    // the panel is lazy-loaded and react-msaview paints to canvas, so wait for
    // its canvases to appear rather than looking for text in the DOM
    await page.waitForFunction(
      (before: number) => document.querySelectorAll('canvas').length > before,
      { timeout: 60_000 },
      canvasesBefore,
    )
    // the jbrowse_dna scheme colors A/C/G/T differently, so a painted alignment
    // shows several distinct colors; a blank canvas would show one
    const distinctColors = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll('canvas')]
      return Math.max(
        ...canvases.map(c => {
          const ctx = c.getContext('2d')
          if (!ctx || !c.width || !c.height) {
            return 0
          }
          const { data } = ctx.getImageData(0, 0, c.width, c.height)
          const seen = new Set<string>()
          for (let i = 0; i < data.length; i += 4) {
            seen.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`)
          }
          return seen.size
        }),
      )
    })
    expect(distinctColors).toBeGreaterThan(3)

    expect(errors.filter(e => /TView|tview/i.test(e))).toEqual([])
    await screenshot(page, '03-tview')
    await page.close()
  }, 180_000)
})

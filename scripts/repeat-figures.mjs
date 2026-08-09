// Regenerates the tandem-repeat figures in img/.
//   pnpm figures:repeats            all of them
//   pnpm figures:repeats fmr1       just the named ones
//
// Each figure is a session, not a click path: the TView's `init` block says
// which locus and which files, and the view resolves it. So a figure here is
// the same thing a user gets from a shared link, and adding one is adding a
// JSON object rather than another wait-then-click.
//
// Needs .test-jbrowse (see pretest:e2e) and starts its own dev server. The
// three GIAB BAM indexes are ~23MB each, fetched once per browser session.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import puppeteer from 'puppeteer'

import { FIGURES, SAMPLE_NAMES } from './lib/figures.mjs'

const PORT = 9000

// How many rows have to carry a base before a column is worth a column.
//
// PacBio HiFi still miscalls the odd indel, and one read's extra base costs
// every row a column of gaps — at FMR1 that was 40-odd columns, a fifth of the
// figure, each one read wide. react-msaview hides a column once the rows with
// nothing there reach `allowedGappyness` percent, so asking for "at least two
// rows" is a percentage of however many rows there turn out to be, which is
// why this is applied after the alignment arrives rather than in the session.
//
// Two rather than more on purpose: it is the weakest rule that removes read
// error, and anything a second read confirms stays on screen. The rows that
// carry a hidden column keep an insertion marker there, so nothing vanishes
// silently.
const MIN_ROWS_PER_COLUMN = 2
/**
 * The whole figure, as the session spec that produces it.
 *
 * A spec view takes its settings flat — `init` is the config/defaultSession
 * form, and nesting them here is the one authoring mistake JBrowse's spec
 * loader calls out by name.
 */
function sessionSpec(figure) {
  const { loc, tracks } = figure
  return {
    name: figure.name,
    views: [
      {
        id: 'lgv',
        type: 'LinearGenomeView',
        // context only: the same reads before the array is unrolled, kept
        // short so the alignment below gets the page
        loc,
        assembly: 'hg19',
        tracks: tracks.map(trackId => ({
          trackId,
          displaySnapshot: { height: 55 },
        })),
      },
      {
        id: 'tview',
        type: 'TView',
        displayName: figure.name,
        assembly: 'hg19',
        loc,
        tracks: tracks.map(t => ({
          trackId: t,
          sample: SAMPLE_NAMES[t] ?? t,
        })),
        connectedViewId: 'lgv',
        height: figure.height ?? 900,
        colWidth: figure.colWidth,
        rowHeight: figure.rowHeight,
        treeAreaWidth: figure.treeAreaWidth,
        labelsAlignRight: true,
        colorSchemeName: 'jbrowse_dna',
        drawTree: tracks.length > 1,
      },
    ],
  }
}

const only = process.argv.slice(2)
const wanted = only.length
  ? FIGURES.filter(f => only.includes(f.name))
  : FIGURES

if (!fs.existsSync('.test-jbrowse')) {
  throw new Error('missing .test-jbrowse — run: pnpm pretest:e2e')
}

const server = spawn('node', ['esbuild.mjs', '--watch'], {
  env: { ...process.env, PORT: `${PORT}` },
  stdio: 'ignore',
})
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/dist/out.js`)).ok) {
      break
    }
  } catch {}
  await new Promise(r => setTimeout(r, 500))
}

const VIEWPORT = { width: 1400, height: 1100, deviceScaleFactor: 2 }

// Every figure is grown from VIEWPORT to whatever its alignment needs, and this
// is where that stops. A figure past it is one to make narrower — fewer
// columns, or a smaller colWidth — rather than one to render at any size.
const MAX_VIEWPORT = { width: 3000, height: 3000 }

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: VIEWPORT,
})

async function capture(page, figure) {
  console.log(`\n[${figure.name}] ${figure.loc}`)
  // each figure sizes the window to itself below, so start from the same one
  await page.setViewport(VIEWPORT)
  const session = encodeURIComponent(JSON.stringify(sessionSpec(figure)))
  await page.goto(
    `http://localhost:${PORT}/.test-jbrowse/index.html?config=../public/repeats.json&session=spec-${session}`,
    { waitUntil: 'networkidle2' },
  )

  // the alignment arriving is the only thing worth waiting for; everything
  // before it is the session resolving itself
  await page.waitForFunction(
    () => {
      const view = window.JBrowseSession?.views.find(v => v.type === 'TView')
      return (view?.rows.length ?? 0) > 1
    },
    { timeout: 600_000, polling: 1000 },
  )

  const report = await page.evaluate(minRows => {
    const view = window.JBrowseSession.views.find(v => v.type === 'TView')
    const rows = view.rows.length
    // A column is hidden once the rows with nothing in it reach this percent,
    // so the percent that means "keep what minRows rows agree on" is a
    // function of the row count. Rounded down to a tenth, which stays inside
    // the band that rounds to the same row count and reads as a number on the
    // toolbar rather than as sixteen decimal places.
    view.setAllowedGappyness(
      Math.floor((1000 * (rows - minRows + 1)) / rows) / 10,
    )
    return {
      rows,
      columns: view.rows[0]?.[1].length,
      hidden: view.blanks.length,
      labels: view.rows.slice(0, 4).map(r => r[0]),
    }
  }, MIN_ROWS_PER_COLUMN)
  console.log(
    `  ${report.rows} rows x ${report.columns} columns (${report.hidden} hidden as under ${MIN_ROWS_PER_COLUMN} rows); top labels: ${report.labels.join(', ')}`,
  )

  // The window is where a figure loses its subject, in both directions: the
  // alignment scrolls sideways inside the view, the view is one of a stack
  // inside a scrolling div, and a screenshot of the window is a screenshot of
  // whatever fit, with nothing in it to say that anything did not.
  //
  // Width first: whether the alignment needs a horizontal scrollbar is what
  // decides how much of the view's height is left for rows.
  const fit = {}
  await new Promise(r => setTimeout(r, 1000))
  fit.width = await page.evaluate(() => {
    const view = window.JBrowseSession.views.find(v => v.type === 'TView')
    const columns = view.rows[0][1].length - view.blanks.length
    // the msa area minus what it currently shows, plus what it has to show
    return window.innerWidth - view.msaAreaWidth + columns * view.colWidth + 20
  })
  await page.setViewport({
    ...page.viewport(),
    width: Math.min(MAX_VIEWPORT.width, Math.ceil(fit.width)),
  })

  // then the view to its rows, and the window to the view. A view taller than
  // the window drops its last rows, and they are the ones a figure of a trio
  // can least afford: rows are ordered longest allele first, so what falls off
  // the bottom is a whole sample.
  await new Promise(r => setTimeout(r, 1000))
  await page.evaluate(() => {
    const view = window.JBrowseSession.views.find(v => v.type === 'TView')
    view.setHeight(
      view.height + view.totalHeight - view.msaAreaHeight + view.rowHeight,
    )
  })

  // The tview is the last view in the session, so where its container ends is
  // where the figure ends — measured off the view rather than off the
  // scrolling div, whose scrollHeight is its own height again once the content
  // fits inside it and so can only ever say "grow".
  await new Promise(r => setTimeout(r, 1000))
  fit.height = await page.evaluate(() => {
    for (const el of document.querySelectorAll('div')) {
      el.scrollTop = 0
    }
    const container = document.querySelector(
      '[data-testid="view-container-tview"]',
    )
    return container.getBoundingClientRect().bottom + 8
  })
  await page.setViewport({
    ...page.viewport(),
    height: Math.min(MAX_VIEWPORT.height, Math.ceil(fit.height)),
  })

  for (const [side, max] of Object.entries(MAX_VIEWPORT)) {
    if (fit[side] > max) {
      console.log(
        `  window capped at ${max}px ${side}; ${Math.ceil(fit[side] - max)}px of the figure is off screen`,
      )
    }
  }

  // and say so if any of that was wrong: a figure that quietly drops the last
  // rows of the last sample is the failure this whole dance exists to prevent,
  // and it looks like a finished figure
  await new Promise(r => setTimeout(r, 1000))
  const short = await page.evaluate(() => {
    const view = window.JBrowseSession.views.find(v => v.type === 'TView')
    const container = document.querySelector(
      '[data-testid="view-container-tview"]',
    )
    return {
      rows: Math.ceil(view.totalHeight - view.msaAreaHeight),
      columns: Math.ceil(
        (view.rows[0][1].length - view.blanks.length) * view.colWidth -
          view.msaAreaWidth,
      ),
      window: Math.ceil(container.getBoundingClientRect().bottom - innerHeight),
    }
  })
  for (const [what, px] of Object.entries(short)) {
    if (px > 0) {
      console.log(`  WARNING: ${px}px of ${what} did not fit`)
    }
  }

  // let react-msaview paint its canvases
  await new Promise(r => setTimeout(r, 6000))
  fs.mkdirSync('img', { recursive: true })
  await page.screenshot({ path: figure.out })
  console.log(`  wrote ${figure.out}`)
}

const page = await browser.newPage()
page.on('console', msg => {
  if (msg.type() === 'error') {
    console.log(`  [browser] ${msg.text()}`)
  }
})
for (const figure of wanted) {
  try {
    await capture(page, figure)
  } catch (e) {
    console.error(`  [${figure.name}] FAILED: ${e.message}`)
  }
}

await browser.close()
server.kill()

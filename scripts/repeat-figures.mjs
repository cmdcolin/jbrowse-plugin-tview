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

const PORT = 9000
const TRIO = ['HG002', 'HG003', 'HG004']
const SAMPLE_NAMES = {
  HG002: 'HG002_son',
  HG003: 'HG003_father',
  HG004: 'HG004_mother',
}

// Windows are the array plus a short flank: a row has to span the array end to
// end to be counted, so the flank only has to show it sitting in ordinary
// sequence.
const FIGURES = [
  {
    name: 'fmr1',
    out: 'img/repeat-fmr1-trio.png',
    // FMR1 sits on the X, so the two male samples carry one allele and the
    // mother two — a copy count that cannot come out right by accident
    loc: 'chrX:146,993,530..146,993,670',
    tracks: TRIO,
    colWidth: 6,
    rowHeight: 6,
    treeAreaWidth: 330,
  },
  {
    name: 'htt',
    out: 'img/repeat-htt-trio.png',
    loc: 'chr4:3,076,570..3,076,730',
    tracks: TRIO,
    colWidth: 6,
    rowHeight: 6,
    treeAreaWidth: 330,
  },
  {
    name: 'atxn3',
    out: 'img/repeat-atxn3-trio.png',
    loc: 'chr14:92,537,320..92,537,420',
    tracks: TRIO,
    colWidth: 7,
    rowHeight: 6,
    treeAreaWidth: 330,
  },
  {
    name: 'abca7',
    out: 'img/repeat-abca7-vntr.png',
    // a 25bp VNTR whose alleles run past 2kb: the case base-to-base alignment
    // cannot afford and left-justification cannot read
    loc: 'chr19:1,049,460..1,050,000',
    tracks: ['HG003'],
    colWidth: 1,
    rowHeight: 22,
    // labelsAlignRight puts long labels flush against the sequence, so they
    // overflow leftwards and the tree area is what has to hold them
    treeAreaWidth: 480,
    height: 580,
  },
]

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

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1400, height: 1100, deviceScaleFactor: 2 },
})

async function capture(page, figure) {
  console.log(`\n[${figure.name}] ${figure.loc}`)
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

  const report = await page.evaluate(() => {
    const view = window.JBrowseSession.views.find(v => v.type === 'TView')
    return {
      rows: view.rows.length,
      columns: view.rows[0]?.[1].length,
      labels: view.rows.slice(0, 4).map(r => r[0]),
    }
  })
  console.log(
    `  ${report.rows} rows x ${report.columns} columns; top labels: ${report.labels.join(', ')}`,
  )

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

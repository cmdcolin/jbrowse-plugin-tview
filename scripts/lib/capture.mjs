/**
 * Taking a picture of a tview, outside of what is in the picture.
 *
 * A figure here is a session, not a click path: the TView's `init` block says
 * which locus and which files, and the view resolves it. So a figure is the
 * same thing a user gets from a shared link, and adding one is adding a JSON
 * object rather than another wait-then-click.
 *
 * Separate from `figures.mjs` because the README's four figures are not the
 * only thing worth photographing — `report:repeats --figure` points the same
 * harness at whatever BAMs it was asked to measure.
 *
 * Needs .test-jbrowse (see pretest:e2e) and starts its own dev server.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer'

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

const VIEWPORT = { width: 1400, height: 1100, deviceScaleFactor: 2 }

// Every figure is grown from VIEWPORT to whatever its alignment needs, and this
// is where that stops. A figure past it is one to make narrower — fewer
// columns, or a smaller colWidth — rather than one to render at any size.
const MAX_VIEWPORT = { width: 3000, height: 3000 }

/** the config a figure is taken against, relative to `.test-jbrowse/` */
const DEFAULT_CONFIG = '../public/repeats.json'

/**
 * The whole figure, as the session spec that produces it.
 *
 * A spec view takes its settings flat — `init` is the config/defaultSession
 * form, and nesting them here is the one authoring mistake JBrowse's spec
 * loader calls out by name.
 */
export function sessionSpec(figure) {
  const { loc, tracks, samples } = figure
  return {
    name: figure.name,
    views: [
      {
        id: 'lgv',
        type: 'LinearGenomeView',
        // context only: the same reads before the array is unrolled, kept
        // short so the alignment below gets the page
        loc,
        assembly: figure.assembly,
        tracks: tracks.map(trackId => ({
          trackId,
          displaySnapshot: { height: 55 },
        })),
      },
      {
        id: 'tview',
        type: 'TView',
        displayName: figure.name,
        assembly: figure.assembly,
        loc,
        tracks: tracks.map(t => ({
          trackId: t,
          sample: samples?.[t] ?? t,
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

/**
 * A url the page can load a file by.
 *
 * The dev server serves the repo root, so a file under it is servable and
 * anything else is not reachable from the browser at all — which is worth
 * saying here rather than letting the view come back empty.
 */
function servable(uri, port) {
  if (/^https?:\/\//.test(uri)) {
    return uri
  }
  const rel = path.relative(process.cwd(), path.resolve(uri))
  if (rel.startsWith('..')) {
    throw new Error(
      `the browser cannot load ${uri}: it is neither a url nor a path under ${process.cwd()}`,
    )
  }
  return `http://localhost:${port}/${rel.split(path.sep).join('/')}`
}

/**
 * A JBrowse config for alignment files that have no config, written where the
 * dev server can serve it.
 *
 * The README's figures are taken against `public/repeats.json`, which names its
 * three tracks; a figure of whatever `--bam` was given has to name them here
 * instead. Without a `fasta` the sequence and the reference-name aliases come
 * from UCSC, the same place the measurement's reference bases do, so a locus
 * written in UCSC's spelling reaches a BAM that spells its references some
 * other way. With one there are no aliases to be had, and the locus has to be
 * written the way the FASTA names it.
 *
 * Returns the path to reference it by, which is relative to `.test-jbrowse/`
 * because that is where the page loading it lives.
 */
export function writeAdhocConfig({
  genome,
  sources,
  fasta,
  port = 9000,
  file = '.figure.json',
}) {
  const ucsc = {
    sequence: {
      type: 'ReferenceSequenceTrack',
      trackId: `${genome}-refseq`,
      adapter: {
        type: 'TwoBitAdapter',
        uri: `https://hgdownload.soe.ucsc.edu/goldenPath/${genome}/bigZips/${genome}.2bit`,
        chromSizes: `https://jbrowse.org/ucsc/${genome}/${genome}.chrom.sizes`,
      },
    },
    refNameAliases: {
      adapter: {
        type: 'RefNameAliasAdapter',
        uri: `https://jbrowse.org/ucsc/${genome}/${genome}.chromAlias.txt`,
      },
    },
  }
  const gz = /\.b?gz$/.test(fasta ?? '')
  const local = fasta
    ? {
        sequence: {
          type: 'ReferenceSequenceTrack',
          trackId: `${genome}-refseq`,
          adapter: {
            type: gz ? 'BgzipFastaAdapter' : 'IndexedFastaAdapter',
            fastaLocation: { uri: servable(fasta, port) },
            faiLocation: { uri: servable(`${fasta}.fai`, port) },
            ...(gz
              ? { gziLocation: { uri: servable(`${fasta}.gzi`, port) } }
              : {}),
          },
        },
      }
    : undefined
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        plugins: [
          { name: 'TView', url: `http://localhost:${port}/dist/out.js` },
        ],
        assemblies: [{ name: genome, ...(local ?? ucsc) }],
        tracks: sources.map(s => ({
          type: 'AlignmentsTrack',
          trackId: s.id,
          name: s.id,
          assemblyNames: [genome],
          adapter: {
            type: 'BamAdapter',
            bamLocation: { uri: servable(s.uri, port) },
            index: { location: { uri: servable(`${s.uri}.bai`, port) } },
          },
        })),
      },
      null,
      2,
    ),
  )
  return `../${file}`
}

async function capture(page, figure, { port }) {
  console.log(`\n[${figure.name}] ${figure.loc}`)
  // each figure sizes the window to itself below, so start from the same one
  await page.setViewport(VIEWPORT)
  const session = encodeURIComponent(JSON.stringify(sessionSpec(figure)))
  await page.goto(
    `http://localhost:${port}/.test-jbrowse/index.html?config=${figure.config ?? DEFAULT_CONFIG}&session=spec-${session}`,
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
    // toolbar rather than as sixteen decimal places. One row is worth
    // 100/rows percent and the rounding gives up 0.1, so the two land on top
    // of each other past a thousand rows — a figure that big wants the
    // threshold set exactly, not a tenth.
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
  //
  // `msaAreaHeight` is not the height the rows get: react-msaview subtracts the
  // header and the minimap from the view's height, but the track area — the
  // conservation plot, ~40px — is laid out above the rows inside what is left.
  // So the space for rows is msaAreaHeight minus totalTrackAreaHeight, and a
  // figure sized by msaAreaHeight alone loses a track's worth of rows off the
  // bottom: at FMR1's 6px rows that was seven of them, and silently, because
  // the model's own numbers say everything fits.
  await new Promise(r => setTimeout(r, 1000))
  await page.evaluate(() => {
    const view = window.JBrowseSession.views.find(v => v.type === 'TView')
    view.setHeight(
      view.height -
        view.msaAreaHeight +
        view.totalTrackAreaHeight +
        (view.rows.length + 1) * view.rowHeight,
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
      rows: Math.ceil(
        view.rows.length * view.rowHeight +
          view.totalTrackAreaHeight -
          view.msaAreaHeight,
      ),
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
  fs.mkdirSync(path.dirname(figure.out), { recursive: true })
  await page.screenshot({ path: figure.out })
  console.log(`  wrote ${figure.out}`)
}

/** the dev server the figures are taken against, once it is answering */
async function serve(port) {
  const server = spawn('node', ['esbuild.mjs', '--watch'], {
    env: { ...process.env, PORT: `${port}` },
    stdio: 'ignore',
  })
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/dist/out.js`)).ok) {
        break
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  return server
}

/**
 * Take each figure, and keep going when one of them fails.
 *
 * A run of four that stops on the first failure leaves three stale PNGs and a
 * README table that no longer describes any of them, so a failure is reported
 * and the rest are still taken.
 */
export async function captureFigures(figures, { port = 9000 } = {}) {
  if (!fs.existsSync('.test-jbrowse')) {
    throw new Error('missing .test-jbrowse — run: pnpm pretest:e2e')
  }
  const server = await serve(port)
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: VIEWPORT,
  })
  const failed = []
  try {
    const page = await browser.newPage()
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`  [browser] ${msg.text()}`)
      }
    })
    for (const figure of figures) {
      try {
        await capture(page, figure, { port })
      } catch (e) {
        failed.push(figure.name)
        console.error(`  [${figure.name}] FAILED: ${e.message}`)
      }
    }
  } finally {
    await browser.close()
    server.kill()
  }
  return { failed }
}

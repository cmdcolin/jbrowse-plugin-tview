// Regenerates img/tview-insertion.png for the README.
//   pnpm figure
// Needs .test-jbrowse (see pretest:e2e) and starts its own dev server.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import puppeteer from 'puppeteer'

const PORT = 9000
const OUT = 'img/tview-insertion.png'
// 19 reads carry a 1bp insertion at ctgA:15163; a tight window keeps bases legible
const LOC = 'ctgA:15,140..15,190'

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
  defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
await page.goto(
  `http://localhost:${PORT}/.test-jbrowse/index.html?config=../public/config.json`,
  { waitUntil: 'networkidle2' },
)
await page.waitForFunction(() => !!window.JBrowseSession, { timeout: 90_000 })
await page.waitForFunction(
  () => !!window.JBrowseSession.views[0]?.tracks[0]?.displays[0],
  { timeout: 90_000 },
)

await page.evaluate(async loc => {
  await window.JBrowseSession.views[0].navToLocString(loc, 'volvox')
}, LOC)
await new Promise(r => setTimeout(r, 6000))

await page.evaluate(() => {
  window.JBrowseSession.views[0].tracks[0].displays[0]
    .trackMenuItems()
    .find(i => i.label === 'Launch tview for visible region')
    .onClick()
})
// Submit is disabled until the dialog's preview lands, so the button is the
// condition itself — where the sentence beside it is only the dialog's wording,
// and waiting on that left this timing out for a phrase it had stopped printing
await page.waitForFunction(
  () =>
    [...document.querySelectorAll('button')].some(
      b => b.textContent.trim() === 'Submit' && !b.disabled,
    ),
  { timeout: 60_000 },
)
await page.evaluate(() => {
  const submit = [...document.querySelectorAll('button')].find(
    b => b.textContent.trim() === 'Submit',
  )
  submit?.click()
})

// widen the columns so individual bases read clearly at figure scale
await page.waitForFunction(
  () =>
    window.JBrowseSession.views.find(v => v.type === 'TView')?.rows.length > 0,
  { timeout: 60_000 },
)
await page.evaluate(() => {
  const session = window.JBrowseSession
  // give the alignment most of the vertical space
  session.views[0].tracks[0].displays[0].setHeight?.(220)

  const v = session.views.find(x => x.type === 'TView')
  v.setColWidth(16)
  v.setRowHeight(15)
  v.setDrawTree(false)
  v.setTreeAreaWidth(230)
  // draw attention to the column the insertion occupies
  const insCol = v.columnToRefPos.indexOf(15163)
  v.setHighlightedColumns([insCol])
})
// let react-msaview repaint its canvases at the new zoom
await new Promise(r => setTimeout(r, 6000))

fs.mkdirSync('img', { recursive: true })
await page.screenshot({ path: OUT })
console.log(`wrote ${OUT}`)

await browser.close()
server.kill()

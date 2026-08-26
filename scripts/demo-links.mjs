// Writes the hosted demo config and the live-demo links in README.md.
//
//   pnpm demos            regenerate public/demo.json and the README block
//   pnpm demos --check    fail if either is not what it would write
//
// A demo link opens the same session spec the figure beside it was taken from,
// so the picture in the README and the thing the link opens cannot come to be
// of different windows — the same reason lib/figures.mjs is shared between the
// figures and the numbers.
//
// It needs no network, unlike readme:repeats, so Integration can check it on
// every push where the measured tables have to wait for the weekly run.
import fs from 'node:fs'

import { sessionSpec } from './lib/capture.mjs'
import { FIGURES } from './lib/figures.mjs'
import { table, writeBlocks } from './lib/readme.mjs'

const README = 'README.md'
const DEV_CONFIG = 'public/repeats.json'
const HOSTED_CONFIG = 'public/demo.json'
const INDEX = 'public/demo-index.html'
const REPO = 'https://github.com/cmdcolin/jbrowse-plugin-tview'

/**
 * A JBrowse that can run this plugin.
 *
 * The nightly rather than a release: the bundle needs `@jbrowse/core` >=4.3
 * with MUI 9, and 4.3.0 itself does not ship it — the same requirement the
 * README states, pointed at something clickable.
 */
const JBROWSE = 'https://jbrowse.org/code/jb2/main/index.html'

/**
 * Where the demo lives on jbrowse.org, which is the same origin the JBrowse
 * above is served from.
 *
 * That is the whole reason to host it rather than to link a config on
 * raw.githubusercontent and a bundle on a CDN: jbrowse-web asks the visitor to
 * confirm a **cross origin** config naming a UMD plugin, and rightly so, but
 * that put a dialog headed "Warning" between a README link and anything
 * rendering. Served from jbrowse.org the question does not arise.
 *
 * It also unpins the demo from npm. `pnpm demos:upload` puts the built bundle
 * here, so the demo shows the code the figures were taken from rather than
 * whatever was last released.
 */
const BUNDLE = 'https://jbrowse.org/demos/tview/plugin.js'

/** root-relative, since it is served from the origin the page is on */
const HOSTED_CONFIG_URL = '/demos/tview/config.json'

/** what each figure's link is called, and what it is worth opening for */
const BLURBS = {
  fmr1: 'CGG on the X, so two of the three samples carry one allele',
  htt: 'the CAG tract, with a shoulder either side of one allele',
  atxn3: 'the locus that reports as four arrays when anchored on insertions',
  abca7: 'a 25bp VNTR whose alleles run past 2kb',
}

function hostedConfig() {
  const config = JSON.parse(fs.readFileSync(DEV_CONFIG, 'utf8'))
  return `${JSON.stringify(
    { ...config, plugins: [{ name: 'TView', url: BUNDLE }] },
    null,
    2,
  )}\n`
}

function link(figure) {
  const session = encodeURIComponent(JSON.stringify(sessionSpec(figure)))
  // the config path goes in unescaped: its slashes are legal in a query value
  // and a kilobyte of session spec follows it, so it is the one part of the
  // url a reader can still recognise
  return `${JBROWSE}?config=${HOSTED_CONFIG_URL}&session=spec-${session}`
}

/**
 * The table, then the urls as link definitions under it.
 *
 * A session spec is a kilobyte of url-encoded JSON, and inline in a cell it
 * would set that column's width for every row — prettier pads a table to its
 * widest cell, so the block would be reformatted the moment it was written and
 * `--check` could never pass. Out of line, the cells stay short and the urls
 * sit where prettier leaves them alone.
 */
function demoBlock() {
  const ref = f => `tview-demo-${f.name}`
  return [
    table([
      ['locus', 'window', 'what it shows', 'open'],
      ...FIGURES.map(f => [
        f.name.toUpperCase(),
        f.loc,
        BLURBS[f.name],
        `[launch][${ref(f)}]`,
      ]),
    ]),
    '',
    // the url on its own indented line, which is where prettier puts a link
    // definition too long for one — emitted that way rather than reformatted
    // afterwards, so `--check` compares against something stable
    ...FIGURES.map(f => `[${ref(f)}]:\n  ${link(f)}`),
  ].join('\n')
}

/**
 * A landing page for the folder, so `jbrowse.org/demos/tview/` is itself a link
 * rather than a 404 for whoever trims one of the long ones.
 *
 * It sends them to the first demo and names where the others are. `&` is
 * written as an entity because a session spec is full of them and this is html,
 * not a url.
 */
function indexPage() {
  const [first] = FIGURES
  const href = link(first).replaceAll('&', '&amp;')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>tview demos</title>
    <meta http-equiv="refresh" content="0; url=${href}" />
  </head>
  <body>
    <p>
      Opening the <a href="${href}">${first.name.toUpperCase()} demo</a> — the
      GIAB trio at a tandem repeat, in a tview. The others are listed in the
      <a href="${REPO}#live-demos">README</a>.
    </p>
  </body>
</html>
`
}

const check = process.argv.includes('--check')
const before = fs.readFileSync(README, 'utf8')
const generated = {
  [README]: writeBlocks(before, { 'demo-links': demoBlock() }),
  [HOSTED_CONFIG]: hostedConfig(),
  [INDEX]: indexPage(),
}

if (check) {
  const stale = Object.entries(generated).filter(
    ([file, body]) =>
      !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body,
  )
  if (stale.length) {
    console.error(
      `${stale.map(([f]) => f).join(' and ')} out of date; run: pnpm demos`,
    )
    process.exitCode = 1
  } else {
    console.log(`${Object.keys(generated).join(', ')} are up to date`)
  }
} else {
  for (const [file, body] of Object.entries(generated)) {
    fs.writeFileSync(file, body)
  }
  console.log(`wrote ${Object.keys(generated).join(', ')}`)
}

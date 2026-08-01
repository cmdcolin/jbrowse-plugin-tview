import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { globalExternals } from '@fal-works/esbuild-plugin-global-externals'
import JBrowseReExports from '@jbrowse/core/ReExports/list'
import prettyBytes from 'pretty-bytes'

const isWatch = process.argv.includes('--watch')
const PORT = process.env.PORT ? +process.env.PORT : 9000

// Plugins must reuse the React/MUI/mobx instances JBrowse already loaded via
// window.JBrowseExports — bundling a second copy causes duplicate-React errors.
function createGlobalMap(jbrowseGlobals) {
  return {
    ...Object.fromEntries(
      jbrowseGlobals.map(g => [
        g,
        { varName: `JBrowseExports["${g}"]`, type: 'cjs' },
      ]),
    ),
    // v4+ package name, but JBrowse exports it as 'mobx-state-tree' for back-compat
    '@jbrowse/mobx-state-tree': {
      varName: `JBrowseExports["mobx-state-tree"]`,
      type: 'cjs',
    },
  }
}

const rebuildLogPlugin = {
  name: 'rebuild-log',
  setup({ onStart, onEnd }) {
    let time = 0
    onStart(() => {
      time = Date.now()
    })
    onEnd(({ metafile, errors, warnings }) => {
      console.log(
        `Built in ${Date.now() - time} ms with ${errors.length} error(s) and ${warnings.length} warning(s)`,
      )
      if (metafile) {
        for (const [file, metadata] of Object.entries(metafile.outputs)) {
          console.log(`Wrote ${prettyBytes(metadata.bytes)} to ${file}`)
        }
      }
    })
  },
}

// @mui/material/SvgIcon's exported SHAPE differs across the MUI majors that
// hosts bundle: released hosts (MUI 7) expose it as the SvgIcon component
// itself ($$typeof, render, displayName), while MUI 9 also hangs
// createSvgIcon off it, which @mui/icons-material v9 calls. Externalizing it
// means the bundle throws "createSvgIcon is not a function" while
// evaluating, so its global is never defined and PluginLoader's Promise.all
// rejects, error-paging every host (see jbrowse-plugin-msaview 2.7.0/2.7.1).
// Bundling it instead works on both MUI generations.
const SHAPE_VARIES_BY_HOST = new Set(['@mui/material/SvgIcon'])
const globals = JBrowseReExports.filter(x => !SHAPE_VARIES_BY_HOST.has(x))

const config = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  // JBrowse reads this off window after the UMD script loads
  globalName: 'JBrowsePluginTView',
  metafile: true,
  plugins: [globalExternals(createGlobalMap(globals)), rebuildLogPlugin],
  ...(isWatch
    ? { outfile: 'dist/out.js' }
    : {
        outfile: 'dist/jbrowse-plugin-tview.umd.production.min.js',
        sourcemap: true,
        minify: true,
      }),
}

function statFile(urlPath) {
  const file = path.join(process.cwd(), decodeURIComponent(urlPath))
  let stats
  if (file.startsWith(process.cwd())) {
    try {
      stats = fs.statSync(file)
    } catch {}
  }
  return stats?.isFile() ? { file, size: stats.size } : undefined
}

/**
 * esbuild's serve ignores a Range whose end is past EOF and answers 200 with the
 * whole file. BAM/CRAM readers then parse byte 0 as if it were the requested
 * offset and fail with "invalid bgzf header", so serve on-disk files here
 * instead, clamping the end per RFC 7233.
 */
function serveRange(req, res) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  const target = match ? statFile(req.url.split('?')[0]) : undefined
  if (target) {
    const { file, size } = target
    const suffixLength = match[1] === '' ? Number(match[2]) : undefined
    const start =
      suffixLength === undefined
        ? Number(match[1])
        : Math.max(0, size - suffixLength)
    const end =
      suffixLength === undefined && match[2] !== ''
        ? Math.min(Number(match[2]), size - 1)
        : size - 1

    if (start >= size || start > end) {
      res.writeHead(416, {
        'Content-Range': `bytes */${size}`,
        'Access-Control-Allow-Origin': '*',
      })
      res.end()
    } else {
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      })
      fs.createReadStream(file, { start, end }).pipe(res)
    }
  }
  return !!target
}

if (isWatch) {
  const ctx = await esbuild.context(config)
  // Proxy esbuild's server so we can inject CORS headers — esbuild dropped CORS
  // support in v0.25.0 and JBrowse Web needs it to fetch the bundle.
  const internalPort = PORT + 400
  const { hosts } = await ctx.serve({ servedir: '.', port: internalPort })

  http
    .createServer((req, res) => {
      if (!serveRange(req, res)) {
        const proxyReq = http.request(
          {
            hostname: hosts[0],
            port: internalPort,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          proxyRes => {
            res.writeHead(proxyRes.statusCode, {
              ...proxyRes.headers,
              'Access-Control-Allow-Origin': '*',
            })
            proxyRes.pipe(res, { end: true })
          },
        )
        req.pipe(proxyReq, { end: true })
      }
    })
    .listen(PORT)

  console.log(`Serving at http://${hosts[0]}:${PORT}`)
  await ctx.watch()
  console.log('Watching files...')
} else {
  const result = await esbuild.build(config)
  // Analyze bundle sizes/imports at https://esbuild.github.io/analyze/
  fs.writeFileSync('meta.json', JSON.stringify(result.metafile))
}

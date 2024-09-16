import * as esbuild from 'esbuild'
import { globalExternals } from '@fal-works/esbuild-plugin-global-externals'
import JbrowseGlobals from '@jbrowse/core/ReExports/list.js'
import prettyBytes from 'pretty-bytes'
import express from 'express'
import serveStatic from 'serve-static'
import cors from 'cors'
import request from 'request'

function createGlobalMap(jbrowseGlobals) {
  const globalMap = {}
  for (const global of jbrowseGlobals) {
    globalMap[global] = {
      varName: `JBrowseExports["${global}"]`,
      type: 'cjs',
    }
  }
  return globalMap
}

if (process.env.NODE_ENV === 'production') {
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    globalName: 'JBrowsePluginTView',
    outfile: 'dist/jbrowse-plugin-msaview.umd.production.min.js',
    sourcemap: true,
    metafile: true,
    minify: true,
    plugins: [
      globalExternals(createGlobalMap(JbrowseGlobals.default)),
      {
        name: 'rebuild-log',
        setup({ onStart, onEnd }) {
          let time
          onStart(() => {
            time = Date.now()
          })
          onEnd(({ metafile, errors, warnings }) => {
            console.log(
              `Built in ${Date.now() - time} ms with ${
                errors.length
              } error(s) and ${warnings.length} warning(s)`,
            )
            if (!metafile) {
              return
            }
            const { outputs } = metafile
            for (const [file, metadata] of Object.entries(outputs)) {
              const size = prettyBytes(metadata.bytes)
              console.log(`Wrote ${size} to ${file}`)
            }
          })
        },
      },
    ],
  })
} else {
  let ctx = await esbuild.context({
    entryPoints: ['src/index.ts'],
    bundle: true,
    globalName: 'JBrowsePluginTView',
    outfile: 'dist/out.js',
    metafile: true,
    plugins: [
      globalExternals(createGlobalMap(JbrowseGlobals.default)),
      {
        name: 'rebuild-log',
        setup({ onStart, onEnd }) {
          let time
          onStart(() => {
            time = Date.now()
          })
          onEnd(({ metafile, errors, warnings }) => {
            console.log(
              `Built in ${Date.now() - time} ms with ${
                errors.length
              } error(s) and ${warnings.length} warning(s)`,
            )
            if (!metafile) {
              return
            }
            const { outputs } = metafile
            for (const [file, metadata] of Object.entries(outputs)) {
              const size = prettyBytes(metadata.bytes)
              console.log(`Wrote ${size} to ${file}`)
            }
          })
        },
      },
    ],
  })
  await ctx.serve({
    servedir: '.',
    port: 8999,
  })
  const app = express()
  app.get('/dist/out.js', function (req, res) {
    var newurl = 'http://localhost:8999/dist/out.js'
    request(newurl).pipe(res)
  })
  app.use(cors({}))
  app.use(serveStatic('public'))

  app.listen(9000, () => {
    console.log(`Example app listening at http://localhost:9000`)
  })

  await ctx.watch()
  console.log('Watching files...')
}

import React from 'react'

import { getSession } from '@jbrowse/core/util'
import { observer } from 'mobx-react'

import { useStyles } from './util'
import { isTView } from '../TViewPanel/model'

import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'

const MsaToGenomeHighlight = observer(function MsaToGenomeHighlight2({
  model,
}: {
  model: LinearGenomeViewModel
}) {
  const { classes } = useStyles()
  const { views } = getSession(model)
  const highlights = views
    .filter(isTView)
    .filter(v => v.connectedViewId === model.id)
    .flatMap(v => v.connectedHighlights)

  return (
    <>
      {highlights.map((r, idx) => {
        const s = model.bpToPx({ refName: r.refName, coord: r.start })
        const e = model.bpToPx({ refName: r.refName, coord: r.end })
        return s && e ? (
          <div
            key={`${r.refName}-${r.start}-${idx}`}
            className={classes.highlight}
            style={{
              left: Math.min(s.offsetPx, e.offsetPx) - model.offsetPx,
              width: Math.max(Math.abs(e.offsetPx - s.offsetPx), 4),
            }}
          />
        ) : null
      })}
    </>
  )
})

export default MsaToGenomeHighlight

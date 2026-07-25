import React from 'react'

import { getSession } from '@jbrowse/core/util'
import { observer } from 'mobx-react'

import { useStyles } from './util'

import type { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'

interface HoverPosition {
  coord: number
  refName: string
}

function getHoverPosition(hovered: unknown): HoverPosition | undefined {
  const pos =
    !!hovered && typeof hovered === 'object' && 'hoverPosition' in hovered
      ? hovered.hoverPosition
      : undefined
  return !!pos &&
    typeof pos === 'object' &&
    'coord' in pos &&
    typeof pos.coord === 'number' &&
    'refName' in pos &&
    typeof pos.refName === 'string'
    ? { coord: pos.coord, refName: pos.refName }
    : undefined
}

const GenomeMouseoverHighlight = observer(function GenomeMouseoverHighlight2({
  model,
}: {
  model: LinearGenomeViewModel
}) {
  const { classes } = useStyles()
  const hoverPosition = getHoverPosition(getSession(model).hovered)

  if (hoverPosition) {
    const { coord, refName } = hoverPosition
    const s = model.bpToPx({ refName, coord: coord - 1 })
    const e = model.bpToPx({ refName, coord })
    if (s && e) {
      return (
        <div
          className={classes.highlight}
          style={{
            left: Math.min(s.offsetPx, e.offsetPx) - model.offsetPx,
            width: Math.max(Math.abs(e.offsetPx - s.offsetPx), 4),
          }}
        />
      )
    }
  }
  return null
})

export default GenomeMouseoverHighlight

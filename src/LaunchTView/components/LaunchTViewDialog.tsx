import React, { useEffect, useState } from 'react'
import { Dialog, ErrorMessage } from '@jbrowse/core/ui'
import { Button, DialogActions, DialogContent } from '@mui/material'
import {
  AbstractTrackModel,
  assembleLocString,
  Feature,
  getContainingView,
  getSession,
} from '@jbrowse/core/util'
import { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'
import { getRpcSessionId } from '@jbrowse/core/util/tracks'
import { getConf } from '@jbrowse/core/configuration'

interface Mismatch {
  type: string
  length: number
  start: number
  base: string
}
function getMaxInsForPos(
  sets: Map<number, Mismatch>[],
  features: Feature[],
  pos: number,
) {
  let maxIns = 0
  // eslint-disable-next-line unicorn/no-for-loop
  for (let i = 0; i < features.length; i++) {
    const feature = features[i]!
    const set = sets[i]!
    const s = feature.get('start')
    const ins = set.get(pos - s)
    if (ins) {
      maxIns = Math.max(+ins.base, maxIns)
    }
  }
  return maxIns
}

// eslint-disable-next-line unicorn/better-regex
const cigarRegex = new RegExp(/([MIDNSHPX=])/)
function parseCigar(cigar = '') {
  return cigar.split(cigarRegex).slice(0, -1)
}

function tview(
  feature: Feature,
  maxInsForPos: Map<number, number>,
  regionStart: number,
  regionEnd: number,
) {
  const seq = feature.get('seq') as string
  const cigarOps = parseCigar(feature.get('CIGAR'))
  const start = feature.get('start')
  let soffset = 0
  let roffset = 0

  let rendered = ''
  for (let i = 0; i < start - regionStart - 1; i++) {
    rendered += ' '
  }
  let insAtPos = 0
  for (let i = 0; i < cigarOps.length; i += 2) {
    const len = +cigarOps[i]!
    const op = cigarOps[i + 1]!

    // eslint-disable-next-line
    if (op === 'S' || op === 'I') {
      soffset += len
      const referencePos = start + roffset
      const z = maxInsForPos.get(referencePos) ?? 0
      const z2 = Math.max(len, z) - len
      for (let m = 0; m < len; m++) {
        if (roffset > regionStart) {
          rendered += seq[soffset + m]
        }
      }
      for (let i = 0; i < z2; i++) {
        if (roffset > regionStart) {
          rendered += '#'
        }
      }
      insAtPos = len
    } else if (op === 'D' || op === 'N') {
      for (let m = 0; m < len; m++) {
        rendered += '-'
        const referencePos = start + roffset
        const z = maxInsForPos.get(referencePos) ?? 0
        for (let i = 0; i < z; i++) {
          rendered += '@'
        }
        roffset++
      }
    } else if (op === 'M' || op === 'X' || op === '=') {
      for (let m = 0; m < len; m++) {
        const letter = seq[soffset]!
        const referencePos = start + roffset

        if (referencePos > regionStart && referencePos < regionEnd) {
          const z = maxInsForPos.get(referencePos) ?? 0
          const z2 = z - insAtPos
          for (let i = 0; i < z2; i++) {
            rendered += '*'
          }
          rendered += letter
          insAtPos = 0
        }
        roffset++
        soffset++
      }
    }
  }
  return rendered
}

export default function LaunchTViewDialog({
  handleClose,
  model,
}: {
  handleClose: () => void
  model: AbstractTrackModel
}) {
  const view = getContainingView(model) as LinearGenomeViewModel
  const session = getSession(model)
  const [msa, setMsa] = useState<[string, string][]>()
  const { rpcManager } = session
  const b0 = view.dynamicBlocks.contentBlocks[0]
  const [error, setError] = useState<unknown>()

  // "coarseDynamicBlocks" is the currently visible regions, with a little
  // debounce so that it doesn't update too fast
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    ;(async () => {
      try {
        if (!view.initialized || !b0) {
          return
        }
        const track = view.tracks[0]
        const adapterConfig = getConf(track, 'adapter')
        const sessionId = getRpcSessionId(track)
        const feats2 = (await rpcManager.call(sessionId, 'CoreGetFeatures', {
          adapterConfig,
          sessionId,
          regions: [b0],
        })) as Feature[]
        const feats = feats2.filter(f => !f.get('seq'))
        const { start: s, end: e } = b0

        const sets = feats.map(
          f =>
            new Map(
              (f.get('mismatches') as Mismatch[] | undefined)
                ?.filter(f => f.type === 'insertion')
                .map(mismatch => [mismatch.start, mismatch]),
            ),
        )
        const maxInsForPos = new Map<number, number>()
        for (let i = s; i < e; i++) {
          maxInsForPos.set(i, getMaxInsForPos(sets, feats, i))
        }

        setMsa(
          feats.map(
            f => [f.get('name'), tview(f, maxInsForPos, s, e)] as const,
          ),
        )
      } catch (e) {
        setError(e)
        console.error(e)
      }
    })()
  }, [rpcManager, view.initialized, b0, view.tracks])
  const displayName = b0 ? assembleLocString(b0) : 'Unknown'

  return (
    <Dialog
      maxWidth="xl"
      title="Launch tview"
      onClose={() => {
        handleClose()
      }}
      open
    >
      <DialogContent>
        <div>
          Create a view similar to "samtools tview" for the reads in the current
          region: {displayName}
        </div>
        {error ? (
          <ErrorMessage error={error} />
        ) : msa ? null : (
          <div>Loading...</div>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          variant="contained"
          color="primary"
          disabled={!msa}
          onClick={() => {
            session.addView('TView', {
              type: 'TView',
              displayName,
              data: {
                msa,
              },
            })
            handleClose()
          }}
        >
          Submit
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => {
            handleClose()
          }}
        >
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  )
}

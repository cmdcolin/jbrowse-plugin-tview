import React, { useEffect, useState } from 'react'
import { Dialog, ErrorMessage } from '@jbrowse/core/ui'
import { Button, DialogActions, DialogContent } from '@mui/material'
import {
  AbstractTrackModel,
  assembleLocString,
  Feature,
  getContainingView,
  getSession,
  max,
} from '@jbrowse/core/util'
import { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'
import { getRpcSessionId } from '@jbrowse/core/util/tracks'
import { getConf } from '@jbrowse/core/configuration'

interface Mismatch {
  type: string
  length: number
  cliplen?: number
  altbase?: string
  qual?: number
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

  const insLens = [...maxInsForPos.entries()].filter(f => !!f[1])
  let rendered = ''
  let idx = 0
  for (let i = regionStart + 1; i < start; i++) {
    const currInsTracker = insLens[idx]
    if (currInsTracker && i === currInsTracker[0]) {
      rendered += '.'.repeat(currInsTracker[1])
      idx++
    }
    rendered += '.'
  }
  let insAtPos = 0
  for (let i = 0; i < cigarOps.length; i += 2) {
    const len = +cigarOps[i]!
    const op = cigarOps[i + 1]!

    if (op === 'S' || op === 'I') {
      soffset += len
      const referencePos = start + roffset
      const z = maxInsForPos.get(referencePos) ?? 0
      const z2 = Math.max(len, z) - len
      for (let m = 0; m < len; m++) {
        if (referencePos > regionStart) {
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

function cigarToMismatches(
  ops: string[],
  seq?: string,
  ref?: string,
  qual?: Buffer,
) {
  let roffset = 0 // reference offset
  let soffset = 0 // seq offset
  const mismatches: Mismatch[] = []
  const hasRefAndSeq = ref && seq
  for (let i = 0; i < ops.length; i += 2) {
    const len = +ops[i]!
    const op = ops[i + 1]!

    if (op === 'M' || op === '=' || op === 'E') {
      if (hasRefAndSeq) {
        for (let j = 0; j < len; j++) {
          if (
            // @ts-ignore in the full yarn build of the repo, this says that object is possibly undefined for some reason, ignored
            seq[soffset + j].toUpperCase() !== ref[roffset + j].toUpperCase()
          ) {
            mismatches.push({
              start: roffset + j,
              type: 'mismatch',
              base: seq[soffset + j]!,
              altbase: ref[roffset + j]!,
              length: 1,
            })
          }
        }
      }
      soffset += len
    }
    if (op === 'I') {
      mismatches.push({
        start: roffset,
        type: 'insertion',
        base: `${len}`,
        length: 0,
      })
      soffset += len
    } else if (op === 'D') {
      mismatches.push({
        start: roffset,
        type: 'deletion',
        base: '*',
        length: len,
      })
    } else if (op === 'N') {
      mismatches.push({
        start: roffset,
        type: 'skip',
        base: 'N',
        length: len,
      })
    } else if (op === 'X') {
      const r = seq?.slice(soffset, soffset + len) || []
      const q = qual?.subarray(soffset, soffset + len) || []

      for (let j = 0; j < len; j++) {
        mismatches.push({
          start: roffset + j,
          type: 'mismatch',
          base: r[j]!,
          qual: q[j]!,
          length: 1,
        })
      }
      soffset += len
    } else if (op === 'H') {
      mismatches.push({
        start: roffset,
        type: 'hardclip',
        base: `H${len}`,
        cliplen: len,
        length: 1,
      })
    } else if (op === 'S') {
      mismatches.push({
        start: roffset,
        type: 'softclip',
        base: `S${len}`,
        cliplen: len,
        length: 1,
      })
      soffset += len
    }

    if (op !== 'I' && op !== 'S' && op !== 'H') {
      roffset += len
    }
  }
  return mismatches
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
  const [msa, setMsa] = useState<string>()
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
        const b0p = {
          ...b0,
          start: Math.floor(b0.start),
          end: Math.floor(b0.end),
        }
        const track = view.tracks[0]
        const adapterConfig = getConf(track, 'adapter')
        const sessionId = getRpcSessionId(track)
        const feats2 = (await rpcManager.call(sessionId, 'CoreGetFeatures', {
          adapterConfig,
          sessionId,
          regions: [b0p],
        })) as Feature[]
        const feats = feats2.filter(f => !!f.get('seq'))
        const { start: s, end: e } = b0p

        const sets = feats.map(
          f =>
            new Map(
              cigarToMismatches(parseCigar(f.get('CIGAR') as string))
                .filter(f => f.type === 'insertion')
                .map(mismatch => [mismatch.start, mismatch]),
            ),
        )
        const maxInsForPos = new Map<number, number>()
        for (let i = s; i < e; i++) {
          maxInsForPos.set(i, getMaxInsForPos(sets, feats, i))
        }
        const r0 = feats.map(
          f => [f.get('name') as string, tview(f, maxInsForPos, s, e)] as const,
        )
        const maxRowLen = max(r0.map(r => r[1].length))

        setMsa(
          r0
            .map(([name, seq]) => `>${name}\n${seq.padEnd(maxRowLen, '.')}\n`)
            .join('\n'),
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
              colWidth: 10,
              rowHeight: 12,
              colorScheme: 'jbrowse_dna',
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

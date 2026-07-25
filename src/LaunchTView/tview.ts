/** the subset of an @jbrowse/core Feature that the layout reads */
export interface AlignmentFeature {
  get: (key: string) => any
}

export interface ReadLayout {
  name: string
  start: number
  /** one char per reference position consumed: aligned base, or '-' for D/N */
  refChars: string
  /** reference position -> bases inserted immediately before that position */
  insertions: Map<number, string>
}

const cigarRegex = /([MIDNSHPX=])/

export function parseCigar(cigar: string) {
  return cigar.split(cigarRegex).slice(0, -1)
}

export function parseRead(feature: AlignmentFeature, name: string): ReadLayout {
  const seq = feature.get('seq') as string
  const ops = parseCigar(feature.get('CIGAR') as string)
  const start = feature.get('start')
  const insertions = new Map<number, string>()
  let refChars = ''
  let seqOffset = 0

  for (let i = 0; i < ops.length; i += 2) {
    const len = +ops[i]!
    const op = ops[i + 1]!
    if (op === 'S') {
      seqOffset += len
    } else if (op === 'I') {
      insertions.set(
        start + refChars.length,
        seq.slice(seqOffset, seqOffset + len),
      )
      seqOffset += len
    } else if (op === 'D' || op === 'N') {
      refChars += '-'.repeat(len)
    } else if (op === 'M' || op === 'X' || op === '=') {
      refChars += seq.slice(seqOffset, seqOffset + len)
      seqOffset += len
    }
    // H and P consume neither the read sequence nor the reference
  }
  return { name, start, refChars, insertions }
}

/** widest insertion any read has at each reference position (sparse) */
export function maxInsertionWidths(reads: ReadLayout[]) {
  const ret = new Map<number, number>()
  for (const read of reads) {
    for (const [pos, ins] of read.insertions) {
      ret.set(pos, Math.max(ret.get(pos) ?? 0, ins.length))
    }
  }
  return ret
}

/**
 * Lays a single read out over [regionStart, regionEnd). Each reference position
 * contributes its insertion columns (widest across all reads) followed by one
 * reference column, so every row comes out the same length and stays aligned.
 */
export function renderRow(
  read: ReadLayout,
  insWidths: Map<number, number>,
  regionStart: number,
  regionEnd: number,
) {
  let ret = ''
  for (let pos = regionStart; pos < regionEnd; pos++) {
    const idx = pos - read.start
    const covered = idx >= 0 && idx < read.refChars.length
    const width = insWidths.get(pos) ?? 0
    if (width) {
      const ins = read.insertions.get(pos) ?? ''
      ret += ins + (covered ? '-' : '.').repeat(width - ins.length)
    }
    ret += covered ? read.refChars[idx] : '.'
  }
  return ret
}

function mateSuffix(flags: number | undefined) {
  return flags === undefined || !(flags & 1) ? '' : flags & 64 ? '/1' : '/2'
}

/** MSA rows are keyed by name, so mates and duplicate names need disambiguating */
function getReadNames(features: AlignmentFeature[]) {
  const counts = new Map<string, number>()
  return features.map(f => {
    const base = `${f.get('name')}${mateSuffix(f.get('flags'))}`
    const n = (counts.get(base) ?? 0) + 1
    counts.set(base, n)
    return n === 1 ? base : `${base}_${n}`
  })
}

export function buildTviewMsa({
  features,
  refName,
  start,
  end,
}: {
  features: AlignmentFeature[]
  refName: string
  start: number
  end: number
}) {
  const names = getReadNames(features)
  const reads = features
    .map((f, i) => parseRead(f, names[i]!))
    .sort((a, b) => a.start - b.start)
  const insWidths = maxInsertionWidths(reads)

  return {
    msa: reads
      .map(r => `>${r.name}\n${renderRow(r, insWidths, start, end)}\n`)
      .join(''),
    insertionWidths: [...insWidths.entries()].sort((a, b) => a[0] - b[0]),
    region: { refName, start, end },
  }
}

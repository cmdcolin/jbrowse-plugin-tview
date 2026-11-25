/** the subset of an @jbrowse/core Feature that the layout reads */
export interface AlignmentFeature {
  get: (key: string) => any
}

/**
 * Only '-' and '.' are treated as gaps by react-msaview (anything else counts
 * as a base in the conservation track and column stats), so the two of them
 * carry the whole vocabulary for "no base here". They are split by meaning:
 *
 * - SPANNED_GAP: the read covers this reference position but aligns no base to
 *   it, i.e. a deletion, or padding in an insertion column
 * - ABSENT: the read is not here at all, i.e. outside its bounds, or skipping
 *   over the position through an N (an intron, not a deleted allele)
 */
export const SPANNED_GAP = '-'
export const ABSENT = '.'

export interface ReadLayout {
  /**
   * Identity, and the row's name in the alignment. Every per-row lookup is
   * keyed by this — the array blocks, the row table — so it is fixed once,
   * here, and nothing downstream rewrites it.
   */
  name: string
  /** the sample the row belongs to, as the caller named it */
  sample?: string
  start: number
  /** one char per reference position consumed: the aligned base, or a gap */
  refChars: string
  /** reference position -> bases inserted immediately before that position */
  insertions: Map<number, string>
}

const cigarRegex = /([MIDNSHPX=])/

export const byStart = (a: ReadLayout, b: ReadLayout) => a.start - b.start

export function parseCigar(cigar: string) {
  return cigar.split(cigarRegex).slice(0, -1)
}

export function parseRead(
  feature: AlignmentFeature,
  name: string,
  sample?: string,
): ReadLayout {
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
      // consecutive I ops (e.g. 3M2I3I3M) land on the same reference position
      const pos = start + refChars.length
      const prev = insertions.get(pos) ?? ''
      insertions.set(pos, prev + seq.slice(seqOffset, seqOffset + len))
      seqOffset += len
    } else if (op === 'D') {
      refChars += SPANNED_GAP.repeat(len)
    } else if (op === 'N') {
      refChars += ABSENT.repeat(len)
    } else if (op === 'M' || op === 'X' || op === '=') {
      refChars += seq.slice(seqOffset, seqOffset + len)
      seqOffset += len
    }
    // H and P consume neither the read sequence nor the reference
  }
  return {
    name,
    sample,
    start,
    refChars,
    insertions,
  }
}

/**
 * Reads are fetched by overlap, so they carry insertions on either side of the
 * region. Those get no columns and are never rendered, so dropping them keeps
 * the pairwise alignment below off the wasted sites entirely.
 */
export function clipInsertions(
  reads: ReadLayout[],
  start: number,
  end: number,
) {
  return reads.map(read => ({
    ...read,
    insertions: new Map(
      [...read.insertions].filter(([pos]) => pos >= start && pos < end),
    ),
  }))
}

function mateSuffix(flags: number | undefined) {
  return flags === undefined || !(flags & 1) ? '' : flags & 64 ? '/1' : '/2'
}

/**
 * MSA rows are keyed by name, and a FASTA defline names its row by the first
 * whitespace-delimited word, dropping any later row whose word repeats. So a
 * name loses its whitespace, mates are told apart by flag, and whatever still
 * collides (the same read in two files, or a name in `reserved`) is numbered.
 */
export function getReadNames(
  features: AlignmentFeature[],
  reserved: string[] = [],
) {
  const taken = new Set(reserved)
  return features.map(f => {
    const base = `${String(f.get('name')).replaceAll(/\s+/g, '_')}${mateSuffix(f.get('flags'))}`
    let name = base
    for (let n = 2; taken.has(name); n++) {
      name = `${base}_${n}`
    }
    taken.add(name)
    return name
  })
}

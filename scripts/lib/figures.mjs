/**
 * The figures in README.md: which locus, which files, and how they are drawn.
 *
 * Separate from the capture harness so that measuring a figure and taking one
 * are the same definition — the numbers the README states about a figure are of
 * the window the figure is of.
 */
import { TRIO } from './giabTrio.mjs'

const ALL = TRIO.map(t => t.id)

export const SAMPLE_NAMES = {
  HG002: 'HG002_son',
  HG003: 'HG003_father',
  HG004: 'HG004_mother',
}

/** `chrX:146,993,530..146,993,670` as the window a measurement takes */
function locus(name, loc, refName) {
  const [chrom, range] = loc.split(':')
  const [start, end] = range.split('..').map(n => Number(n.replaceAll(',', '')))
  return { name, chrom, refName, start: start - 1, end }
}

// Windows are the array plus a short flank: a row has to span the array end to
// end to be counted, so the flank only has to show it sitting in ordinary
// sequence.
export const FIGURES = [
  {
    name: 'fmr1',
    out: 'img/repeat-fmr1-trio.png',
    // FMR1 sits on the X, so the two male samples carry one allele and the
    // mother two — a copy count that cannot come out right by accident
    loc: 'chrX:146,993,530..146,993,670',
    refName: 'X',
    tracks: ALL,
    colWidth: 6,
    rowHeight: 6,
    treeAreaWidth: 330,
  },
  {
    name: 'htt',
    out: 'img/repeat-htt-trio.png',
    loc: 'chr4:3,076,570..3,076,730',
    refName: '4',
    tracks: ALL,
    colWidth: 6,
    rowHeight: 6,
    treeAreaWidth: 330,
  },
  {
    name: 'atxn3',
    out: 'img/repeat-atxn3-trio.png',
    loc: 'chr14:92,537,320..92,537,420',
    refName: '14',
    tracks: ALL,
    colWidth: 7,
    rowHeight: 6,
    treeAreaWidth: 330,
  },
  {
    name: 'abca7',
    out: 'img/repeat-abca7-vntr.png',
    // a 25bp VNTR whose alleles run past 2kb: the case base-to-base alignment
    // cannot afford and left-justification cannot read
    loc: 'chr19:1,049,460..1,050,000',
    refName: '19',
    tracks: ['HG003'],
    colWidth: 1,
    rowHeight: 22,
    // labelsAlignRight puts long labels flush against the sequence, so they
    // overflow leftwards and the tree area is what has to hold them
    treeAreaWidth: 480,
    height: 580,
  },
].map(figure => ({
  ...figure,
  locus: locus(figure.name, figure.loc, figure.refName),
}))

/**
 * The figures in README.md: which locus, which files, and how they are drawn.
 *
 * Separate from the capture harness so that measuring a figure and taking one
 * are the same definition — the numbers the README states about a figure are of
 * the window the figure is of.
 */
import { GENOME, TRIO } from './giabTrio.mjs'

const ALL = TRIO.map(t => t.id)

/** the label each sample's band is drawn under */
const SAMPLE_NAMES = {
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
    rowHeight: 8,
  },
  {
    name: 'htt',
    out: 'img/repeat-htt-trio.png',
    loc: 'chr4:3,076,570..3,076,730',
    refName: '4',
    tracks: ALL,
    colWidth: 6,
    rowHeight: 8,
  },
  {
    name: 'atxn3',
    out: 'img/repeat-atxn3-trio.png',
    loc: 'chr14:92,537,320..92,537,420',
    refName: '14',
    tracks: ALL,
    colWidth: 7,
    rowHeight: 8,
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
    // the `n` panel holds three digits only at this height or below
    rowHeight: 16,
    // sixteen rows leave room for the read names
    view: {},
  },
].map(figure => ({
  // read names say nothing a figure of copy counts needs, and fitted to the
  // widest of them the label column takes a third of the figure; at this width
  // they are cut in the middle and the track names beside them still fit
  view: { treeAreaWidth: 220 },
  ...figure,
  assembly: GENOME,
  samples: SAMPLE_NAMES,
  showsCopies: true,
  locus: locus(figure.name, figure.loc, figure.refName),
}))

/**
 * The figures `pnpm figure` takes from the fixtures in `public/`, which need no
 * network. Every column is kept, since these are about what one read does.
 */
export const LOCAL_FIGURES = [
  {
    name: 'insertion',
    out: 'img/tview-insertion.png',
    config: '../public/config.json',
    assembly: 'volvox',
    // 19 reads carry a 1bp insertion at ctgA:15163
    loc: 'ctgA:15,140..15,190',
    tracks: ['volvox_bam'],
    colWidth: 16,
    rowHeight: 15,
    genomeTrackHeight: 220,
    minRowsPerColumn: 1,
  },
  {
    name: 'modifications',
    out: 'img/tview-modifications.png',
    config: '../public/config.json',
    assembly: 'hg38_clip',
    // nanopore reads with 5mC calls, one of them on a base a read inserted
    // after 20:13,243; the flank on the right is what the legend covers
    loc: '20:13,226..13,275',
    tracks: ['methylation_clip'],
    colWidth: 16,
    // band labels are cut short above 16px rows, and 16 itself is taken as
    // unset and replaced
    rowHeight: 15,
    genomeTrackHeight: 160,
    minRowsPerColumn: 1,
    view: {
      residueColor: { field: 'feature', scale: { scheme: 'jbrowse_dna' } },
    },
  },
]

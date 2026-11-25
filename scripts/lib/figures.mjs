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

/** the settings every figure of the GIAB trio shares */
function giab(figure) {
  return {
    // read names say nothing a figure of copy counts needs, and fitted to the
    // widest of them the label column takes a third of the figure; at this
    // width they are cut in the middle and the track names beside them still
    // fit
    view: { treeAreaWidth: 220 },
    label: figure.name.toUpperCase(),
    ...figure,
    assembly: GENOME,
    samples: SAMPLE_NAMES,
    locus: locus(figure.name, figure.loc, figure.refName),
  }
}

// Windows are the array plus a short flank: a row has to span the array end to
// end to be counted, so the flank only has to show it sitting in ordinary
// sequence.
export const REPEAT_FIGURES = [
  {
    name: 'fmr1',
    blurb: 'CGG on the X, so two of the three samples carry one allele',
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
    blurb: 'the CAG tract, with a shoulder either side of one allele',
    out: 'img/repeat-htt-trio.png',
    loc: 'chr4:3,076,570..3,076,730',
    refName: '4',
    tracks: ALL,
    colWidth: 6,
    rowHeight: 8,
  },
  {
    name: 'atxn3',
    blurb: 'the locus that reports as four arrays when anchored on insertions',
    out: 'img/repeat-atxn3-trio.png',
    loc: 'chr14:92,537,320..92,537,420',
    refName: '14',
    tracks: ALL,
    colWidth: 7,
    rowHeight: 8,
  },
  {
    // one sample of the trio above, whose two alleles are far enough apart to
    // read as a ladder of two steps at any size
    name: 'atxn3-hg004',
    label: 'ATXN3, HG004',
    blurb: 'the mother alone, a CTG ladder of two steps',
    out: 'img/repeat-atxn3-hg004.png',
    loc: 'chr14:92,537,320..92,537,420',
    refName: '14',
    tracks: ['HG004'],
    colWidth: 7,
    rowHeight: 8,
    from: 'tview',
  },
  {
    name: 'abca7',
    blurb: 'a 25bp VNTR whose alleles run past 2kb',
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
].map(figure => giab({ ...figure, showsCopies: true }))

// An Alu in an intron of NPHP4, 290bp in the reads, which the GIAB HG002 SV
// benchmark (v0.6) calls heterozygous at 1:5,934,288. HG002 has it from his
// father, and his mother has none of it.
const ALU = {
  label: 'NPHP4 Alu',
  loc: 'chr1:5,934,190..5,934,390',
  refName: '1',
  colWidth: 3,
}

export const INSERTION_FIGURES = [
  {
    ...ALU,
    name: 'alu',
    label: 'NPHP4 Alu, HG002',
    out: 'img/insertion-alu.png',
    blurb: 'an Alu insertion in about half the reads, aligned base by base',
    tracks: ['HG002'],
    rowHeight: 8,
    genomeTrackHeight: 160,
    hideGenomeHeader: true,
    from: 'lgv',
  },
  {
    ...ALU,
    name: 'alu-trio',
    out: 'img/insertion-alu-trio.png',
    blurb: 'a band per sample: the son and the father have it, the mother not',
    tracks: ALL,
    rowHeight: 5,
    from: 'tview',
  },
].map(giab)

/** every figure of the GIAB trio, each of which is also a live demo */
export const FIGURES = [...INSERTION_FIGURES, ...REPEAT_FIGURES]

// Nanopore reads with 5mC calls, one of them on a base a read inserted after
// 20:13,243; the flank on the right is what the legend covers. The two figures
// differ only in what the cells are coloured by.
const MODIFICATIONS = {
  config: '../public/config.json',
  assembly: 'hg38_clip',
  loc: '20:13,226..13,275',
  tracks: ['methylation_clip'],
  colWidth: 16,
  rowHeight: 15,
  minRowsPerColumn: 1,
  from: 'tview',
}

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
    minRowsPerColumn: 1,
    from: 'tview',
  },
  {
    ...MODIFICATIONS,
    name: 'modifications',
    out: 'img/tview-modifications.png',
    view: {
      treeAreaWidth: 220,
      residueColor: { field: 'feature' },
    },
  },
  {
    ...MODIFICATIONS,
    name: 'modifications-bases',
    out: 'img/tview-modifications-bases.png',
    view: { treeAreaWidth: 220 },
  },
].map(figure => ({ hideGenomeHeader: true, from: 'lgv', ...figure }))

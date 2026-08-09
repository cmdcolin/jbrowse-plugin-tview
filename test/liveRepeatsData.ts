/**
 * The public data the QC harness reads: which samples, which loci, and the two
 * fetches. Kept apart from the harness so importing it runs nothing.
 */
import { BamFile } from '@gmod/bam'

const GIAB = 'https://ftp-trace.ncbi.nlm.nih.gov/giab/ftp/data/AshkenazimTrio'

export const TRIO = [
  {
    id: 'HG002',
    role: 'son',
    url: `${GIAB}/HG002_NA24385_son/PacBio_CCS_15kb_20kb_chemistry2/GRCh37/HG002.SequelII.merged_15kb_20kb.pbmm2.hs37d5.haplotag.RTG.10x.trio.bam`,
  },
  {
    id: 'HG003',
    role: 'father',
    url: `${GIAB}/HG003_NA24149_father/PacBio_CCS_15kb_20kb_chemistry2/hs37d5/HG003.SequelII.merged_15kb_20kb.pbmm2.hs37d5.haplotag.RTG.10x.trio.bam`,
  },
  {
    id: 'HG004',
    role: 'mother',
    url: `${GIAB}/HG004_NA24143_mother/PacBio_CCS_15kb_20kb_chemistry2/hs37d5/HG004.SequelII.merged_15kb_20kb.pbmm2.hs37d5.haplotag.RTG.10x.trio.bam`,
  },
]

/** GRCh37 windows, wide enough that reads span the array end to end */
export const LOCI = [
  {
    name: 'HTT (CAG)',
    chrom: 'chr4',
    refName: '4',
    start: 3076500,
    end: 3076800,
  },
  {
    name: 'ATXN3 (CTG)',
    chrom: 'chr14',
    refName: '14',
    start: 92537250,
    end: 92537550,
  },
  {
    name: 'TCF4 CTG18.1',
    chrom: 'chr18',
    refName: '18',
    start: 53253300,
    end: 53253600,
  },
  {
    name: 'DMPK (CTG)',
    chrom: 'chr19',
    refName: '19',
    start: 46273350,
    end: 46273650,
  },
  {
    name: 'FMR1 (CGG)',
    chrom: 'chrX',
    refName: 'X',
    start: 146993400,
    end: 146993800,
  },
  {
    name: 'C9orf72 (GGGGCC)',
    chrom: 'chr9',
    refName: '9',
    start: 27573400,
    end: 27573700,
  },
  {
    name: 'ABCA7 VNTR',
    chrom: 'chr19',
    refName: '19',
    start: 1049400,
    end: 1050200,
  },
]

export async function referenceSequence(
  chrom: string,
  start: number,
  end: number,
) {
  const res = await fetch(
    `https://api.genome.ucsc.edu/getData/sequence?genome=hg19&chrom=${chrom}&start=${start}&end=${end}`,
  )
  const json = (await res.json()) as { dna: string }
  return json.dna.toUpperCase()
}

export async function fetchReads(
  url: string,
  refName: string,
  start: number,
  end: number,
) {
  const bam = new BamFile({ bamUrl: url, baiUrl: `${url}.bai` })
  await bam.getHeader()
  const records = await bam.getRecordsForRange(refName, start, end)
  return records
    .filter(r => !!r.seq)
    .map(r => ({ get: (key: string) => r[key as keyof typeof r] }))
}

# Handoff — repeat measurement after the re-anchoring change

Scratch notes for whoever picks this up. Delete when the follow-ups are done.
Work so far is committed as `2b95ec3`, on top of `9b9d7ae` / `5de809d`.

## What this session did

The previous session's review left two soundness problems in
`absorbAdjacentInsertions`. Both are fixed, by replacing the rule rather than
patching it. The literature was searched first; the algorithms used are cited in
the code and again at the bottom of this file.

### The interval no longer moves

`absorbAdjacentInsertions` widened the shared reference interval to cover
insertions the aligner anchored just outside an array. That made one read's
misplacement everyone's — a single spurious copy two bases early moved the
array's left edge for every row, and the reference's own copy count with it.

`reanchorInsertions` (`src/LaunchTView/alleles.ts`) re-files each **read's**
insertions under the array they belong to, one read at a time. The interval is
now a property of the reference alone and nothing in the read path can move it.
Deleted with it: `ABSORB_COPIES`, `ABSORB_IDENTITY`, and the whole
previousEnd/floor/ceiling neighbour-collision apparatus (neighbours now split
the reference between them at the midpoint, which no read can shift).

### Rotation is preferred, but it cannot be the test

Where the read's own bases allow it, the insertion is **rewritten by rotation**
rather than moved (`shiftInsertion`), so the row renders base for base as the
aligner wrote it and only the position it is filed under changes. This is exact.

It is also, measurably, not sufficient — and this is the finding worth keeping,
because it is what a rotation-only implementation gets wrong. **An aligner picks
the highest-scoring placement, not an equivalent one.** FMR1's misplaced read
carries `CGCGCGGCGGCGGCGGCGGCGGCGCGGAGGCG` anchored at 146993565, where the
reference reads `...GCAGC` — the insert starts on a `C` and the read has a `G`
there, so **no rewrite of it exists**. A rotation-only build was measured: it
lost that read, lost two more at ATXN3, and lost the ABCA7 764bp and 1207bp
expansions, and single-row columns went up (FMR1 63 to 89, ABCA7 998 to 1021).

So `unitIdentity` still decides what belongs. Its review defect is fixed: it
scored only the first 300bp normalized by the probe, so `unit x 12 + 1kb of
junk` scored 1.00. It now scores head, middle and tail and reports the worst.
`test/align.test.ts` pins that case.

### Alleles collect their skirt

`alleleModes` (`src/LaunchTView/repeatStats.ts`) reported only reads whose copy
count matched exactly, so an allele was credited with a fraction of the reads
that support it. It now gathers counts strongest first and lets a count join an
allele if it is both near it (within a tenth of its size) and much weaker than
it (under a third of its support).

**Both halves are needed and a distance rule alone cannot work here.** No
bandwidth separates FMR1's mother's two alleles, one copy apart, from HTT's one
allele with a shoulder either side. Swept over the trio: relative support is the
discriminating parameter (0.2 leaves reads uncounted, 0.3 is right, 0.4 merges
the mother's alleles); the distance fraction barely matters.

## Measured effect on the trio

Every allele call is preserved. FMR1 and ABCA7 shift down one copy for every row
including the reference, because their intervals no longer grow. Every locus
stays Mendelian.

| | before | after |
| --- | --- | --- |
| FMR1 reference | 22 copies | **21** (the interval is the reference's again) |
| FMR1 father / mother / son | 31, 32/33, 33 | 30, 31/32, 32 |
| ABCA7 reference | 20 | 19 |
| ABCA7 father | 21 / 89 | 20 / 88 |
| ATXN3 interval | 92537353 (widened) | 92537354 (as scanned) |
| reads counted into no allele | 150 of 989 | **41** |

HTT, TCF4, DMPK and C9orf72 are bit-identical apart from gaining skirt reads.

### ABCA7's outlier is real, and follow-up 6 is answered

The read that read as 135 copies is **not chimeric**. Its insert is 1207bp of
`CACCACTCCCTCCCCGTGAGG...`, which is the VNTR's own 25bp unit read from offset
6, and the same sample carries a 764bp one at the same anchor. Both are genuine
expansions the aligner placed 19bp outside the array. It reads 134 now only
because the interval shrank.

## Follow-ups, roughly in order

1. **The figures in `img/` are stale.** The copy-count labels baked into the
   PNGs are the old numbers, and `README.md`'s `repeat-figures` table was
   regenerated from fresh measurements, so the table and the images it names
   currently disagree. Run `pnpm figures:repeats` (needs the JBrowse test build
   and playwright) and re-run `pnpm readme:repeats`.
2. **The jbrowse-components tutorial was not started.** See the section below —
   it needs a decision before it can be, not just time.
3. **`test/liveRepeatsData.ts` and `scripts/lib/giabTrio.mjs` are still two
   copies** of the trio and loci. `test/liveRepeats.qc.ts` should go away in
   favour of `pnpm report:repeats`, or import the shared definitions. Untouched
   again this session.
4. **`pnpm readme:repeats --check` is still not wired into CI.** It needs the
   network (GIAB + the UCSC API), so it does not belong in `preversion`; a
   scheduled workflow, or a job that tolerates being skipped offline.
5. **The report generator only reads reference sequence from the UCSC API.**
   `--genome hg19` works; a local FASTA does not (needs an indexed-fasta reader,
   not currently a dependency).
6. **`--figure` on the report CLI.** The capture harness in
   `scripts/repeat-figures.mjs` is still tied to the four README figures; it
   wants extracting to `scripts/lib/capture.mjs` so the report can produce a PNG
   for an arbitrary BAM set. `scripts/lib/figures.mjs` was split out with that
   in mind.
7. **Nothing has been tried on short reads or ONT.** Everything here is PacBio
   HiFi. The flank is `FLANK_BP` / one copy in `alleles.ts`; cuteSV's own
   constants differ 3x between CCS and noisy reads, so expect the noisier set to
   want more.
8. **`SHOULDER_SPREAD` was swept on 21 sample-locus calls.** That is a shelf, not
   a proof. A locus with three real alleles within a copy of each other would
   defeat it, and the trio has none.

## The tutorial task, and why it stopped

The ask was to update a tutorial in `~/src/jbrowse-components` with screenshots.
What was found:

- **There is no tandem-repeat tutorial there, and it was parked deliberately.**
  `agent-docs/OTHER_IDEAS.md` ("Parked"): the biology is interesting but "the
  interesting alleles are non-reference and an expansion is hard to read in a
  linear genome view. Revisit only if there is a rendering answer first (a
  pangenome or graph projection, or a **per-allele length encoding**), not as a
  data-loading walkthrough." The unit-per-block layout with `n=` labels is that
  per-allele length encoding, so this work is what unparks it.
- **Two hard blockers, both outside the plugin repo.** Figures are an S3-backed
  store (`website/scripts/figures.ts`, `pnpm figures:push` "needs AWS"), and the
  bytes are gitignored, so a new `<Figure src>` fails `check-figure-refs` until
  someone with credentials pushes. And a spec-driven figure loads the plugin
  from the store's `latest/` path (the pattern `PROTEIN3D_CONFIG` uses), which
  will serve the **old** measurement until this change is published — the
  screenshots would disagree with the README by one copy at FMR1 and ABCA7.

So the order has to be: regenerate `img/` (follow-up 1), publish the plugin,
then build `test_data/tview_config.json` + a spec in `website/scripts/specs/`
and push the figures. Ask before publishing: per `../CLAUDE.md` a publish here
is a live change to configs already in the wild.

## What this has to do with the derived-allele work in jbrowse-components

Two findings, neither acted on, both filed here so they are not lost.

- **`computePaths.ts` does cuteSV's first step and not its second.**
  `buildClusterOf` leader-sweeps junction endpoints at `tolerance: 20`.
  Clustering *positions* at a constant bp tolerance is defensible, since
  placement jitter really is roughly constant in bp. What is missing is the
  refinement pass: two reads agreeing on both endpoints within 20bp but carrying
  **different amounts of inserted sequence** merge into one candidate, and the
  path signature (`refName:cluster:strand`) has no length term. cuteSV partitions
  on exactly that. For COLO829's der(3) the 183bp chr12 templated insert is the
  case; a read traversing the same three anchors with 150bp instead is currently
  invisible. Also worth noting: cuteSV's `TH_type` is 50-500bp *per SV type*
  against JBrowse's single 20bp, and the chr9 fold-back's two real junctions sit
  28bp apart.
- **The `seq: ''` problem has a browser-shaped answer.** `agent-docs/TODO.md`
  rules out minimap2-in-wasm because the derivative assembly has no bases, and
  `SV_MULTIHOP.md` records that `projectReadsOntoDerivative` was reverted because
  "it cannot fail at base level". Truvari's `phab` is the counter-pattern —
  reconstruct each haplotype's sequence over a region, MSA it, re-call — and
  tview is a working browser implementation of it. Done per junction rather than
  per contig the anchors are the two breakend positions and the sequences are
  what each read actually carries across the join, so a read that disagrees shows
  up as mismatches in real bases. That is the failure mode the reverted lane
  could not produce.

## Things worth knowing before touching it

- **`extractAllele` reads the slot at `end`,** so two arrays sharing a position
  would count the same insertion into two alleles. `flankWindows` holds
  neighbours apart at the midpoint of the reference between them; there is a
  test.
- **Two insertion events in one read landing in the same slot** are concatenated
  in genomic order of where the aligner put them. Total length is preserved,
  which is what the measurement is made of; if a third event between them does
  not move, the rendered order of those bases can differ from the read's.
- **`allowedGappyness` is a percentage of rows, and `.` counts as a gap.** The
  figures set it after load from the actual row count, which is why it lives in
  the harness and not the session spec.
- **`view.setHeight` is not enough on its own** and a container that fits its
  content reports `scrollHeight === clientHeight`. Height is measured off
  `[data-testid="view-container-tview"]`.

## Papers and tools used

- **English et al., "Analysis and benchmarking of small and large genomic
  variants across tandem repeats", Nat Biotechnol 42 (2024),
  doi:10.1038/s41587-024-02225-z** — the adotto catalog's +/-25bp buffer and the
  measurement that a further 10bp moves 0.2% of boundaries; also Truvari `phab`
  harmonization (reconstruct, MSA, re-call), which is architecturally what tview
  does. MIT.
- **Tan, Abecasis & Kang, "Unified representation of genetic variants",
  Bioinformatics 31 (2015), doi:10.1093/bioinformatics/btv112** — left-alignment
  / shift equivalence, which `shiftInsertion` applies with the array as the
  canonical anchor instead of the left.
- **Jiang et al., "Long-read-based human genomic structural variation detection
  with cuteSV", Genome Biol 21 (2020), doi:10.1186/s13059-020-02107-y** —
  clustering-and-refinement; the size-proportional bandwidth form used by
  `alleleModes`. MIT.
- **otter / TREAT (Genome Res 34, 2024)** — flank recalibration: align the
  reference flanks (100bp, 90% similarity) into each read and take what is
  between. MIT. Not implemented; the per-read re-anchoring here is the cheap
  equivalent given that tview already has the CIGAR parsed.
- **Straglr (GPL-3), LongTR (GPL-2), vamos (GPL-2), tandem-genotypes (GPL-3)** —
  read the papers, do not copy code; this plugin is MIT.
- **TRGT is NOT usable as a source.** Its `LICENSE.md` is a PacBio EULA, not an
  OSI license: section 3 restricts use to "data generated on a PacBio
  instrument" and section 7 forbids reverse engineering and treats the software
  as confidential. Cite the paper (Nat Biotechnol 42, 2024,
  doi:10.1038/s41587-023-02057-3); do not read or vendor the source, and note it
  cannot even be run as an oracle on ONT data.

## Commands

```
pnpm report:repeats            # measure the trio, print what it found
pnpm report:repeats --json     # the same, machine readable
pnpm readme:repeats            # write the measured blocks into README.md
pnpm readme:repeats --check    # fail if README.md and the data disagree
pnpm figures:repeats [name]    # regenerate img/repeat-*.png  (STALE, see #1)
pnpm test                      # unit tests, no network
```

All of the first four hit GIAB and the UCSC API; a full run is a few minutes and
tens of MB.

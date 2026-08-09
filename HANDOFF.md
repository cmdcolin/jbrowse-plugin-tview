# Handoff — repeat figures, allele measurement, generated numbers

Scratch notes for whoever picks this up. Delete when the follow-ups are done.
Work so far is committed as `9b9d7ae`.

## What the session started from

"It is pretty hard to tell what is going on in repeat-fmr1-trio... not sure if
infrequent 'spurious' indels cause large gaps... could try to hide gappy
columns."

That turned out to be three separate problems, and the first one was a
measurement bug rather than a rendering one.

## What was found

Measured by building the plan over the figure's own window and counting, per
column, how many rows have a base there:

1. **A misplaced repeat allele, not a spurious indel.** One HG003 read carried
   `CGCGCGGCGGCGGCGGCGGCGGCGCGGAGGCG` — 32bp of FMR1's own CGG — anchored at
   146993565, two bases before the array the reference scan found at 146993567.
   Outside the interval it belonged to no allele: it got 32 columns of its own
   (13% of the figure), and the read was counted as carrying the **reference**
   allele.

   This is systematic, not one read. At ATXN3 the aligner anchored 63 of 162
   reads' expansions at 92537353, one base before the array at 92537354, and
   another 62 at 92537354 itself — same allele, two anchors, only one of them
   counted. It is why HG004 read as 8/8 "with 3 reads at 21".

2. **The figure was clipped.** Viewport 1400x1100, LGV ~305px, tview 900px → ~22
   rows off the bottom. Rows are ordered longest allele first, so what fell off
   was all of HG003. The father was never in the picture.

3. **Read error, which is what the question was about.** After (1), 48 of 222
   columns were still <10% occupied, nearly all of them one read wide.

## What was done

- `absorbAdjacentInsertions` (`src/LaunchTView/alleles.ts`) widens an array over
  an insertion within **one copy** of its edge whose sequence is the array's own
  unit. Both thresholds are in the file with the data behind them.
- `unitIdentity` (`src/LaunchTView/align.ts`) scores an insert against the unit
  tiled end to end, free at both ends of the tiling. Real repeat alleles in the
  trio score 0.94–1.00, unrelated sequence ≤0.67; the cutoff is 0.8.
- `scripts/repeat-figures.mjs` sizes the window to the alignment in both
  directions, hides columns only one row has a base in, and **warns** when
  something did not fit rather than writing a plausible-looking truncated PNG.
- `src/LaunchTView/repeatStats.ts` + `scripts/repeat-report.mjs` +
  `scripts/repeat-readme.mjs`: the numbers in the README are generated and
  `pnpm readme:repeats --check` fails if they drift.

### Measurement changes this caused

| locus                 | before           | after                                    |
| --------------------- | ---------------- | ---------------------------------------- |
| ATXN3 father          | 8 / 17           | 15 / 17                                  |
| ATXN3 mother          | 8 / 8            | 8 / 21                                   |
| ATXN3 son             | 8 / 17           | 17 / 21                                  |
| FMR1 (all)            | 21 ref, 30/31/32 | 22 ref, 31/32/33 (+1, interval grew 2bp) |
| ABCA7 father expanded | 87, 88, 88       | 89, 89, 89                               |

ATXN3 is still Mendelian and now explains the mother's second allele instead of
calling it noise. FMR1 shifts by one copy for everyone because the interval grew
— every row pays it equally, which is the design.

## Follow-ups, roughly in order

1. **`test/liveRepeatsData.ts` and `scripts/lib/giabTrio.mjs` are now two copies
   of the trio and loci.** `test/liveRepeats.qc.ts` should either go away in
   favour of `pnpm report:repeats` or import the shared definitions. Left alone
   this session only because the QC harness is what the README's older prose
   points at.
2. **`pnpm readme:repeats --check` is not wired into CI.** It needs the network
   (GIAB + the UCSC API), so it does not belong in `preversion`; a scheduled
   workflow, or a job that tolerates being skipped offline, is the right home.
3. **Some prose numbers are still hand-typed** — the "60 of 162 reads" in the
   _interval grows to the allele_ bullet, and the FMR1 caption's 33 / 31 /
   32-33. They are correct as of `9b9d7ae` but they are exactly the class of
   thing this session was asked to stop hand-typing. Either add blocks for them
   or reword to point at the generated tables.
4. **The report generator only reads reference sequence from the UCSC API.**
   `--genome hg19` works; a local FASTA does not (would need an indexed-fasta
   reader, not currently a dependency). That is the main thing between it and
   "point it at any BAM".
5. **`--figure` on the report CLI.** The capture harness in
   `scripts/repeat-figures.mjs` is still tied to the four README figures. It
   wants extracting to `scripts/lib/capture.mjs` so the report can produce a PNG
   (and/or a session URL) for an arbitrary BAM set — the "report generator that
   takes a bam or set of bams and creates a jbrowse image and/or instance" idea.
   `scripts/lib/figures.mjs` was split out with that in mind.
6. **ABCA7 has a new outlier.** A read that read as 58 copies now reads as 135,
   having absorbed a 1207bp insert anchored 19bp outside the array. By the rule
   it is right — the read really does carry that much sequence between the two
   anchors — but nobody has looked at whether the read is chimeric. It is
   flagged in the README's "where it is weaker".
7. **The absorb rule has not been tried on short reads or on ONT.** Everything
   here is PacBio HiFi. One copy of slack is the aligner's placement ambiguity
   for HiFi; a noisier read set may want more, and the constant is
   `ABSORB_COPIES`.

## Things worth knowing before touching it

- **`allowedGappyness` is a percentage of rows, and `.` counts as a gap.**
  Setting it as a plugin default would be dangerous over a wide region, where
  most rows are absent from most columns and nearly everything would hide. The
  figures set it _after_ load, computed from the actual row count, which is why
  it lives in the harness and not in the session spec.
- **`view.setHeight` is not enough on its own.** JBrowse stacks views in one
  scrolling div; the view can fit its rows while the window does not fit the
  view. Both are sized, width first, because the horizontal scrollbar is what
  decides how much height is left.
- **A container that fits its content reports `scrollHeight === clientHeight`,**
  so it can only ever say "grow". The height is measured off
  `[data-testid="view-container-tview"]` instead.
- **Two arrays may not meet.** The slot at an array's `end` is one it reads, so
  a shared position would be counted into two alleles;
  `absorbAdjacentInsertions` holds neighbours apart and there is a test for it.

## Commands

```
pnpm report:repeats            # measure the trio, print what it found
pnpm report:repeats --json     # the same, machine readable
pnpm readme:repeats            # write the measured blocks into README.md
pnpm readme:repeats --check    # fail if README.md and the data disagree
pnpm figures:repeats [name]    # regenerate img/repeat-*.png
pnpm test                      # unit tests, no network
```

All of the first four hit GIAB and the UCSC API; a full run is a few minutes and
tens of MB.

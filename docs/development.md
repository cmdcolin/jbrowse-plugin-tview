# Development

```bash
pnpm install
pnpm start            # dev server on :9000 (or $PORT), serves dist/out.js with CORS
pnpm test             # unit tests
pnpm test:e2e         # puppeteer tests (creates .test-jbrowse on first run)
pnpm lint
pnpm build

pnpm figure           # the figures in img/ from the fixtures in public/
pnpm figures:giab     # the figures in img/ from the GIAB trio
pnpm report:repeats   # copy numbers at known loci, from live GIAB data
pnpm readme:repeats   # ...written into docs/tandem-repeats.md
pnpm demos            # public/demo.json and the live-demo links in the docs
pnpm demos:upload     # ...and push both to jbrowse.org/demos/tview/
```

`pnpm start` serves the repo root, so a JBrowse instance unpacked at
`.test-jbrowse` can load the plugin from the same origin via
`http://localhost:9000/.test-jbrowse/index.html?config=../public/config.json`.

## Where the alignment is built

The alignment is built in an RPC worker (`TviewGetPlan`). The worker fetches the
reads, runs the pairwise alignments and builds the rows, then returns the
alignment, a table describing each row, the brackets and any base modification
calls, so the reads never reach the main thread. Several files are read in one
call and laid against the same reference interval, so a tandem array's copies
are counted once over the rows from every file.

## Demos

`pnpm demos` writes `public/demo.json` from `public/repeats.json`, and writes
the demo links from the figure definitions in `scripts/lib/figures.mjs`, so each
link opens the session spec its figure was taken from. It needs no network, so
Integration runs `pnpm demos --check` on every push.

`pnpm demos:upload` builds the plugin, writes `config.json`, `plugin.js` and an
`index.html` under `s3://jbrowse.org/demos/tview/`, and invalidates that path.
The index redirects to the first demo, so the folder URL works on its own. The
upload needs AWS credentials for the bucket, so a maintainer runs it by hand,
and the links open whatever was last uploaded.

The demo is hosted on jbrowse.org, the origin JBrowse Web nightly is served
from, because jbrowse-web asks a visitor to confirm a cross-origin config that
names a UMD plugin. With the config on GitHub and the bundle on a CDN, every
demo link would open on a dialog headed "Warning".

## Figures

The figures are defined as session specs in `scripts/lib/figures.mjs` and taken
by `scripts/lib/capture.mjs`. The harness starts its own dev server on port
9000, or on `FIGURE_PORT` when it is set, with esbuild's server 400 above it. On
another port it writes a copy of the config naming the bundle there and deletes
it afterwards. For each figure it prints the rows, columns, hidden columns and
brackets, and whether residue letters are drawn, and it warns when a repeat
figure has no copy counts or has rows or columns that did not fit.

## Measuring repeats

`pnpm report:repeats` fetches reads from GIAB and reference bases from UCSC, and
prints the copy counts the plan builder measured at each locus for each sample.
The output is for reading against what each locus is known to have: Mendelian
inheritance across the trio, one allele on the X in the males, and published
allele ranges. The loci and samples are defined in `scripts/lib/giabTrio.mjs`,
which the figures also use, so a figure and the numbers beside it are of the
same window.

The report also takes other files and loci, and `--figure` takes a screenshot
with the figure harness:

```bash
pnpm report:repeats \
  --bam HG002=https://host/HG002.bam \
  --loc chrX:146,993,530..146,993,670 \
  --genome hg19 --ref-name X \
  --figure img/fmr1.png
```

- `--genome` names a UCSC genome. The reference bases come from the UCSC API,
  and for `--figure` the browser's assembly is built from UCSC's 2bit and
  chromAlias files. `--ref-name` gives the name the BAM uses for the same
  sequence.
- `--fasta <indexed.fa>` reads the reference from disk, for a genome UCSC does
  not host. A FASTA has no aliases, so write the locus with the FASTA's sequence
  names.
- `--figure` can load a URL, or a path under the repo, which the dev server
  serves.

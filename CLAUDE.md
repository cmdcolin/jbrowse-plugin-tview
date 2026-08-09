# jbrowse-plugin-tview

See `../CLAUDE.md` for the publishing rules that apply to every plugin here.

## The mst/mobx overrides in `pnpm-workspace.yaml` come out when v5 ships

This plugin targets **JBrowse v5+ only**, and its stack is already v5-shaped:
`@jbrowse/mobx-state-tree@6`, `mobx@7`, `mobx-react@10` — which is also what
`react-msaview@5.7.1` declares as peers.

`@jbrowse/core@4.3.0` is still the newest published core, and it depends on
`@jbrowse/mobx-state-tree@^5.6.0` / `mobx@^6.15.3`. Without pinning, both mst
majors land in the tree and **every model type that crosses the `@jbrowse/core`
boundary fails to typecheck** — mst's types are nominal, so a v6 `IModelType` is
not a v5 `IAnyModelType` (`[$type]` missing). It surfaces far from the cause:
`types.compose('TView', BaseViewModel, MSAModelF(), …)` silently loses its named
overload, which collapses `isTView`'s narrowing, so `connectedViewId` and
`connectedHighlights` "don't exist" over in
`AddHighlightModel/MsaToGenomeHighlight.tsx`.

So `pnpm-workspace.yaml` carries:

```yaml
overrides:
  '@jbrowse/mobx-state-tree': ^6.1.0
  mobx: ^7.0.0
  mobx-react: ^10.0.0
```

**Delete that block once `@jbrowse/core` v5 is published** and bump core +
`@jbrowse/plugin-linear-genome-view` to `^5`. At that point core ships mst 6
natively, the tree dedupes on its own, and the override is just a pin that will
eventually hold something back. `pnpm why @jbrowse/mobx-state-tree` should say
"Found 1 version" with or without it.

Note the overrides are in `pnpm-workspace.yaml`, not the `pnpm.overrides` key in
`package.json` — pnpm 11 stopped reading that key and only warns that it was
ignored, so an override put there looks applied but does nothing.

## `typescript` is held at 6.x by eslint, not by this code

`tsc` passes on TypeScript 7, but no `typescript-eslint` release supports it yet
— 8.66.0 and the `8.66.1-alpha.*` line both cap at `>=4.8.4 <6.1.0`, and
`pnpm lint` dies at import time with "typescript-eslint does not support TS 7.0"
rather than reporting a rule failure. Since `preversion` is
`pnpm lint && pnpm build`, a TS 7 bump blocks publishing entirely.

Retry the bump when typescript-eslint widens that peer range
(typescript-eslint#10940 tracks it); nothing in `src/` needs to change.

## Where the repeat measurement may not be read from

This plugin is MIT. The algorithms it uses are cited where they are implemented
(`alleles.ts`, `repeatStats.ts`); these are the sources that constrain what may
be looked at at all:

- **TRGT is not usable as a source.** Its `LICENSE.md` is a PacBio EULA, not an
  OSI license: section 3 restricts use to "data generated on a PacBio
  instrument" and section 7 forbids reverse engineering and treats the software
  as confidential. Cite the paper (Nat Biotechnol 42, 2024,
  doi:10.1038/s41587-023-02057-3); do not read or vendor the source, and note it
  cannot even be run as an oracle on ONT data.
- **Straglr (GPL-3), LongTR (GPL-2), vamos (GPL-2), tandem-genotypes (GPL-3)** —
  read the papers, do not copy code.
- Permissively licensed and safe to read: Truvari/adotto, cuteSV, otter/TREAT
  (all MIT). otter's flank recalibration — align the reference flanks into each
  read and take what is between — is not implemented; the per-read re-anchoring
  in `alleles.ts` is the cheap equivalent given that tview already has the CIGAR
  parsed.

## Everything here was measured on PacBio HiFi

The trio, the loci, the constants and the figures are all one chemistry. Nothing
has been tried on short reads or ONT, and the flank in `alleles.ts` (`FLANK_BP`,
or one copy, whichever is larger) is the parameter to expect to want more of:
cuteSV's own constants differ 3x between CCS and noisy reads.

The allele constants in `repeatStats.ts` were swept over the same 21
sample-locus calls; the shelf that gives them, and what would defeat it, is
recorded beside them.

## The jbrowse-components tandem-repeat tutorial, and what blocks it

`agent-docs/OTHER_IDEAS.md` in `~/src/jbrowse-components` parked a tandem-repeat
tutorial deliberately: the biology is interesting but "the interesting alleles
are non-reference and an expansion is hard to read in a linear genome view.
Revisit only if there is a rendering answer first (a pangenome or graph
projection, or a **per-allele length encoding**), not as a data-loading
walkthrough." The unit-per-block layout with `n=` labels is that per-allele
length encoding, so this plugin is what unparks it.

Two blockers, both outside this repo, and they fix the order of the work:

- Figures there are an S3-backed store (`website/scripts/figures.ts`,
  `pnpm figures:push` "needs AWS") and the bytes are gitignored, so a new
  `<Figure src>` fails `check-figure-refs` until someone with credentials
  pushes.
- A spec-driven figure loads the plugin from the store's `latest/` path (the
  pattern `PROTEIN3D_CONFIG` uses), which serves whatever is published — so the
  screenshots disagree with this README until the measurement change is
  released.

So: publish the plugin first, then build `test_data/tview_config.json` plus a
spec in `website/scripts/specs/`, then push the figures. Ask before publishing —
per `../CLAUDE.md` a publish here is a live change to configs already in the
wild.

## Two findings for the derived-allele work next door

Neither is acted on here; both came out of this measurement work and are about
`~/src/jbrowse-components`.

- **`computePaths.ts` does cuteSV's first step and not its second.**
  `buildClusterOf` leader-sweeps junction endpoints at `tolerance: 20`.
  Clustering _positions_ at a constant bp tolerance is defensible, since
  placement jitter really is roughly constant in bp. What is missing is the
  refinement pass: two reads agreeing on both endpoints within 20bp but carrying
  **different amounts of inserted sequence** merge into one candidate, and the
  path signature (`refName:cluster:strand`) has no length term. cuteSV
  partitions on exactly that. For COLO829's der(3) the 183bp chr12 templated
  insert is the case; a read traversing the same three anchors with 150bp
  instead is currently invisible. cuteSV's `TH_type` is also 50-500bp _per SV
  type_ against JBrowse's single 20bp, and the chr9 fold-back's two real
  junctions sit 28bp apart.
- **The `seq: ''` problem has a browser-shaped answer.** `agent-docs/TODO.md`
  rules out minimap2-in-wasm because the derivative assembly has no bases, and
  `SV_MULTIHOP.md` records that `projectReadsOntoDerivative` was reverted
  because "it cannot fail at base level". Truvari's `phab` is the
  counter-pattern — reconstruct each haplotype's sequence over a region, MSA it,
  re-call — and tview is a working browser implementation of it. Done per
  junction rather than per contig, the anchors are the two breakend positions
  and the sequences are what each read actually carries across the join, so a
  read that disagrees shows up as mismatches in real bases. That is the failure
  mode the reverted lane could not produce.

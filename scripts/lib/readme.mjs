/**
 * Rewriting the generated blocks of README.md in place.
 *
 * Shared because there are two generators and they run on different schedules:
 * the measured tables need live GIAB data and so are checked weekly, while the
 * demo links need nothing but the repo and are checked on every push. Both
 * write the same way, and `--check` is only ever "would writing change it".
 */

/** every `<!-- name -->…<!-- /name -->` pair, replaced by what was generated */
export function writeBlocks(markdown, blocks) {
  let ret = markdown
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(
      `(<!-- ${name} -->\\n)[\\s\\S]*?(\\n<!-- /${name} -->)`,
      'g',
    )
    if (!re.test(ret)) {
      throw new Error(`README.md has no <!-- ${name} --> block`)
    }
    // blank lines around the body because that is where prettier puts them,
    // and a block prettier would reformat is a block --check can never pass
    ret = ret.replace(re, `$1\n${body}\n$2`)
  }
  return ret
}

/** a markdown table from rows of cells, the first row being the header */
export function table(rows) {
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map(r => String(r[i]).length)),
  )
  const line = cells =>
    `| ${cells.map((c, i) => String(c).padEnd(widths[i])).join(' | ')} |`
  return [
    line(rows[0]),
    `| ${widths.map(w => '-'.repeat(w)).join(' | ')} |`,
    ...rows.slice(1).map(line),
  ].join('\n')
}

#!/usr/bin/env bash
# Build the plugin and publish it to the beta demo bucket.
#
# This is how a jbrowse-components demo gets a tview to load without an npm
# release: nothing in the store changes, so anyone who added TView from the
# plugin list keeps whatever `latest/` already served them.
#
# Same two traps as the other plugins here, handled the same way:
#
#   1. uploading a stale dist/ — so this always cleans and rebuilds, and gates
#      on lint, typecheck and tests first, because the artifact is public the
#      moment it lands.
#   2. an upload nobody can see. jbrowse.org sits behind CloudFront, so an
#      object written without Cache-Control keeps being served from the edge
#      long after a successful S3 write. Cache-Control is set explicitly and the
#      entry point is invalidated every time.
#
# The build below is `build:bundle` rather than `build`: tsconfig.json has
# `outDir: dist`, so `pnpm build` also writes .js/.d.ts/.js.map for every source
# file next to the bundle, and `aws s3 cp dist/ --recursive` would publish the
# whole compiled source tree alongside it.
#
# Every build also lands under a content-addressed prefix, <PREFIX>/<hash>/, so
# a config can pin the exact bundle it was written against. That matters here:
# the plugin is not in the jbrowse-components repo, so without a pin a deploy
# would silently change every tview figure over there with no commit to
# attribute it to — and these figures are of measured copy numbers, so a changed
# bundle can make a published figure disagree with the caption beside it.
#
# Finishes by downloading what the CDN actually serves and comparing it to what
# was just built. That comparison is the whole point.
#
# Env overrides: BUCKET, PREFIX, DISTRIBUTION_ID, SKIP_CHECKS=1
set -euo pipefail

cd "$(dirname "$0")/.."

BUCKET="${BUCKET:-jbrowse.org}"
PREFIX="${PREFIX:-demos/tview}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-E13LGELJOT4GQO}"
ENTRY="jbrowse-plugin-tview.umd.production.min.js"
BASE_URL="https://${BUCKET}/${PREFIX}"

echo "==> publishing to s3://${BUCKET}/${PREFIX}/"

if [ "${SKIP_CHECKS:-0}" != "1" ]; then
  echo "==> lint"
  pnpm lint
  # Not optional, and not covered by the unit tests: a bundle that imports a
  # name a host global does not actually export builds and unit-tests clean,
  # then throws the moment the view mounts.
  echo "==> typecheck"
  pnpm typecheck
  echo "==> tests"
  pnpm test
fi

echo "==> build"
pnpm clean
NODE_ENV=production node esbuild.mjs

if [ ! -f "dist/${ENTRY}" ]; then
  echo "no dist/${ENTRY} after build" >&2
  exit 1
fi

# Nothing in this bundle is content-hashed — it is one fixed-name UMD file plus
# its map — so its own digest is what identifies the build.
VERSION=$(md5sum "dist/${ENTRY}" | cut -d' ' -f1 | cut -c1-12)

# A whole immutable copy first, so a config can point at it the moment the
# entry point below goes live. Nothing under here is ever rewritten.
echo "==> upload pinnable copy at ${VERSION}/ (immutable)"
aws s3 cp dist/ "s3://${BUCKET}/${PREFIX}/${VERSION}/" --recursive \
  --cache-control "public, max-age=31536000, immutable"

echo "==> upload entry point (short ttl)"
aws s3 cp dist/ "s3://${BUCKET}/${PREFIX}/" --recursive \
  --cache-control "public, max-age=60"

echo "==> invalidate entry point"
invalidation=$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/${PREFIX}/${ENTRY}" "/${PREFIX}/${ENTRY}.map" \
  --query 'Invalidation.Id' --output text)
echo "    $invalidation"

until [ "$(aws cloudfront get-invalidation --distribution-id "$DISTRIBUTION_ID" \
  --id "$invalidation" --query 'Invalidation.Status' --output text)" = "Completed" ]; do
  sleep 10
done

echo "==> verify what the CDN serves matches what was built"
served=$(mktemp)
trap 'rm -f "$served"' EXIT
local_md5=$(md5sum "dist/${ENTRY}" | cut -d' ' -f1)
for base in "${BASE_URL}" "${BASE_URL}/${VERSION}"; do
  curl -fsS -o "$served" "${base}/${ENTRY}"
  served_md5=$(md5sum "$served" | cut -d' ' -f1)
  if [ "$local_md5" != "$served_md5" ]; then
    echo "MISMATCH: built $local_md5 but ${base}/${ENTRY} serves $served_md5" >&2
    exit 1
  fi
  echo "    ok, ${base}/${ENTRY}"
done

# The bundle registers itself on a global that the JBrowse plugin loader reads
# back by name. A rename in esbuild.mjs would still build, upload and serve, and
# only fail at load time with "plugin did not define JBrowsePluginTView".
echo "==> verify the UMD global is present"
grep -q 'JBrowsePluginTView' "$served" || {
  echo "served bundle does not mention the JBrowsePluginTView global" >&2
  exit 1
}

echo "==> done: ${BASE_URL}/${ENTRY}"
echo "    pin configs at ${BASE_URL}/${VERSION}/${ENTRY}"

#!/usr/bin/env bash

set -euo pipefail

cd "$(
  cd -- "$(dirname "$0")/../.." >/dev/null 2>&1
  pwd -P
)"

RELEASE_FILE_NAME=${GITHUB_RUN_NUMBER}
RELEASE_NAME=gh-${RELEASE_FILE_NAME}
HASH=$(git rev-parse HEAD)

# Clear the output
rm -rf out/dist
mkdir -p out/dist
echo "${HASH}" >out/dist/git_hash
echo "${RELEASE_NAME}" >out/dist/release_build

# Create any autogenerated files.
python3 ./etc/scripts/changelog.py
python3 ./etc/scripts/politic.py


# Set up and build and webpack everything
rm -rf node_modules
npm install --no-audit
npm run webpack

# Now install only the production dependencies
rm -rf node_modules
npm install --no-audit --production

# Output some magic for GH to set the branch name
echo "::set-output name=branch::${GITHUB_REF#refs/heads/}"

# Run to make sure we haven't just made something that won't work
node -r esm -r ts-node/register ./app.js --version --dist

rm -rf out/dist-bin
mkdir -p out/dist-bin
export XZ_OPT="-1 -T 0"
tar -Jcf "out/dist-bin/${RELEASE_FILE_NAME}.tar.xz" -T gh-dist-files.txt
tar -Jcf "out/dist-bin/${RELEASE_FILE_NAME}.static.tar.xz" --transform="s,^out/dist/static/,," out/dist/static/*
echo "${HASH}" >"out/dist-bin/${RELEASE_FILE_NAME}.txt"
du -ch out/**/*

# Create and set commits for a sentry release if and only if we have the secure token set
# External GitHub PRs etc won't have the variable set.
if [ -n "${SENTRY_AUTH_TOKEN+x}" ]; then
  npm run sentry -- releases new -p compiler-explorer "${RELEASE_NAME}"
  npm run sentry -- releases set-commits --auto "${RELEASE_NAME}"
  npm run sentry -- releases files "${RELEASE_NAME}" upload-sourcemaps out/dist/static
fi

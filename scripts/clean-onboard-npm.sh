#!/bin/bash -ex
export PC_TEST_ROOT="$(mktemp -d /tmp/noralos-clean.XXXXXX)"
export PC_HOME="$PC_TEST_ROOT/home"
export PC_CACHE="$PC_TEST_ROOT/npm-cache"
export PC_DATA="$PC_TEST_ROOT/noralos-data"
mkdir -p "$PC_HOME" "$PC_CACHE" "$PC_DATA"
echo "PC_TEST_ROOT: $PC_TEST_ROOT"
echo "PC_HOME: $PC_HOME"
cd $PC_TEST_ROOT
env HOME="$PC_HOME" \
  npm_config_cache="$PC_CACHE" \
  npm_config_userconfig="$PC_HOME/.npmrc" \
  npx --yes noralos onboard --yes --data-dir "$PC_DATA"
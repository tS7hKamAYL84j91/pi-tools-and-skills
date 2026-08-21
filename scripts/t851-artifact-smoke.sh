#!/usr/bin/env bash
set -euo pipefail

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
export HOME="$workdir/home"
mkdir -p "$HOME" "$workdir/consumer"

npm pack --silent --pack-destination "$workdir" . >/dev/null
(cd extensions/pi-boost && npm pack --silent --pack-destination "$workdir") >/dev/null
cd "$workdir/consumer"
npm init -y >/dev/null
npm install --ignore-scripts "$workdir"/*.tgz >/dev/null
node --input-type=module -e '
import {existsSync} from "node:fs";
import {join} from "node:path";
const root = process.cwd();
if (!existsSync(join(root, "node_modules", "pi-boost", "config", "boost.md"))) {
  throw new Error("installed Boost artifact is missing config/boost.md");
}
'
pi --offline --no-session --no-extensions --version >/dev/null

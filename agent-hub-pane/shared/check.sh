#!/usr/bin/env bash
# Isolated fixtures only: no model workers, live sessions or configuration edits.
set -euo pipefail
cd -- "$(dirname -- "$0")"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
cargo fmt -- --check
rustfmt --edition 2021 --check src/plugin.rs
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --tests -- --test-threads=1
cargo build --locked --release --bin pi-hub-index
cargo +nightly-2026-02-12 build --locked --release --target wasm32-wasip1 --bin pi-shared-hub
node test-actions-zellij.mjs --deny
node test-actions-zellij.mjs
node test-actions-zellij.mjs --reject-focus
node test-actions-zellij.mjs --focus
node test-zellij.mjs --scale
node test-zellij.mjs --scale --crash

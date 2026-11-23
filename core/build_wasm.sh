#!/usr/bin/env sh
cargo build --target wasm32-unknown-unknown

cargo run bin wasm-bindgen -- --target experimental-nodejs-module --out-dir node target/wasm32-unknown-unknown/debug/transcribee_core.wasm

#!/usr/bin/env sh
cargo build -Zbuild-std=std,panic_abort --target wasm32-unknown-unknown
/home/robin/.cargo/bin/wasm-bindgen --target experimental-nodejs-module --out-dir node target/wasm32-unknown-unknown/debug/transcribee_core.wasm

(cd node && node a.js)

#!/usr/bin/env bash
# Rebuilds withdraw.bundle.js. Run from this directory.
#
# Bundled rather than loaded from a CDN because esm.sh serves React twice —
# Privy's build gets its own copy, two Reacts share one tree, and every hook
# dies on "Cannot read properties of null (reading 'useContext')". ?deps did
# not fix it and esm.sh times out building the graph.
set -e
npm install --no-audit --no-fund --legacy-peer-deps \
  react@18.3.1 react-dom@18.3.1 @privy-io/react-auth@3.42.0 esbuild
# Stripe funding and the memo program are imported by Privy's Solana module for
# features this page never uses. The stub throws by name if ever reached.
./node_modules/.bin/esbuild src.jsx --bundle --format=iife --minify \
  --define:process.env.NODE_ENV='"production"' --define:global=window \
  --alias:@stripe/stripe-js=./stub.js \
  --alias:@solana/kit/program-client-core=./stub.js \
  --alias:@solana-program/memo=./stub.js \
  --loader:.jsx=jsx --target=es2020 \
  --outfile=../withdraw.bundle.js

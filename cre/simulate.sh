#!/usr/bin/env bash
# Run the Segundo keeper workflow in the CRE simulator against Monad testnet.
#   ./simulate.sh               dry run (reads Till and the rate sources, prepares the report, sends nothing)
#   ./simulate.sh --broadcast   also sends the report on Monad testnet through the MockKeystoneForwarder
# Needs: `cre login` once, Bun, and a funded testnet key in ../keys/cre.json ({"address", "key"}; /keys/ is
# gitignored). That key signs nothing else, so a broadcast never races the relayer for a nonce. Without the file
# it falls back to KEEPER_KEY in ../web/.env.local. The key is read into this process only; never written or printed.
#
# Under WSL the repo sits on a Windows drive, where compiling to WASM is very slow, so the project is
# mirrored to the Linux filesystem first (node_modules is installed there once).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.cre/bin:$HOME/.bun/bin:$PATH"

if [ -f "$here/../keys/cre.json" ]; then
  from="keys/cre.json"
  key=$(grep -oE '"key"[[:space:]]*:[[:space:]]*"(0x)?[0-9a-fA-F]{64}"' "$here/../keys/cre.json" | head -1 | grep -oE '[0-9a-fA-F]{64}"$' | tr -d '"')
else
  from="KEEPER_KEY in web/.env.local"
  key=$(grep -E '^KEEPER_KEY=' "$here/../web/.env.local" | head -1 | cut -d= -f2- | tr -d '\r"'"'"' ')
fi
key=${key#0x}
if [ ${#key} -ne 64 ]; then echo "Signing key missing or malformed ($from)" >&2; exit 1; fi
echo "Signing with $from" >&2
export CRE_ETH_PRIVATE_KEY="$key"

work="${SEGUNDO_CRE_WORKDIR:-$HOME/.cache/segundo-cre}"
mkdir -p "$work"
rsync -a --delete --exclude node_modules --exclude contracts --exclude .env --exclude .pkg.stamp \
  --exclude '*.wasm' --exclude .cre_build_tmp.js "$here/" "$work/"
if ! cmp -s "$work/segundo-keeper/package.json" "$work/segundo-keeper/.pkg.stamp" 2>/dev/null; then
  (cd "$work/segundo-keeper" && bun install && cp package.json .pkg.stamp)
fi

cd "$work"
cre workflow simulate ./segundo-keeper --target staging-settings --non-interactive --trigger-index 0 "$@"

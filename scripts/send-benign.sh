#!/usr/bin/env bash
# Fire a benign user-flow tx sequence against the deployed FakeLendingPool on
# 0G Galileo (chain id 16602). The withdraw at the end is what the Phulax
# Guardian workflow's `web3/query-transactions` filter catches; with the small
# amount and normal user pattern, no detection tier should fire.
#
# Sequence:
#   1. mint pUSD to the deployer (DemoAsset is permissionless mint)
#   2. approve the pool to spend pUSD
#   3. supply 50 pUSD to the pool
#   4. withdraw 1 pUSD from the pool   <-- caught by the workflow
#
# Reads PRIVATE_KEY from contracts/.env (the deployer EOA).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=/dev/null
set -a
. "$REPO/contracts/.env"
set +a

: "${PRIVATE_KEY:?PRIVATE_KEY missing — set it in contracts/.env (deployer EOA)}"

RPC="${ZEROG_RPC_URL:-https://evmrpc-testnet.0g.ai}"
POOL="${POOL_ADDRESS:-0xb1DE7278b81e1Fd40027bDac751117AE960d8747}"
PUSD="${DEMO_ASSET_ADDRESS:-0x21937016d3E3d43a0c2725F47cC56fcb2B51d615}"
TIP="2gwei" # Galileo minimum priority fee — see CLAUDE.md sharp edges

EOA="$(cast wallet address --private-key "$PRIVATE_KEY")"

# 0G Galileo's RPC occasionally returns null on `eth_getTransactionReceipt`
# before the receipt propagates, making `cast send` throw "server returned a
# null response when a non-null response was expected". Submit with --async
# and poll the receipt ourselves.
send_async_and_wait() {
  local label="$1"; shift
  local hash
  hash="$(cast send --async --rpc-url "$RPC" --private-key "$PRIVATE_KEY" \
    --priority-gas-price "$TIP" "$@")"
  echo "  tx: $hash"
  for _ in $(seq 1 30); do
    local status
    status="$(cast receipt "$hash" --rpc-url "$RPC" --json 2>/dev/null \
      | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -1)"
    if [ -n "$status" ]; then
      case "$status" in
        0x1|"1"|"success") echo "  status: success ($label)"; return 0 ;;
        *)                 echo "  status: FAILED ($label, status=$status)"; return 1 ;;
      esac
    fi
    sleep 1
  done
  echo "  status: TIMEOUT waiting for receipt ($label)"
  return 1
}

echo "==> RPC:       $RPC"
echo "==> Pool:      $POOL"
echo "==> pUSD:      $PUSD"
echo "==> EOA:       $EOA"

# --- Step 1: ensure the EOA has at least 100 pUSD --------------------------
have="$(cast call "$PUSD" "balanceOf(address)(uint256)" "$EOA" --rpc-url "$RPC" | awk '{print $1}' | sed 's/_.*$//')"
threshold="100000000000000000000" # 100e18
if [ -z "$have" ] || [ "$(printf '%s\n%s\n' "$have" "$threshold" | sort -n | head -1)" = "$have" ] && [ "$have" != "$threshold" ]; then
  echo
  echo "==> Step 1: mint 100 pUSD to $EOA"
  send_async_and_wait "mint" \
    "$PUSD" "mint(address,uint256)" "$EOA" 100000000000000000000
else
  echo
  echo "==> Step 1: balance already sufficient ($have wei), skipping mint"
fi

# --- Step 2: approve pool ---------------------------------------------------
allowance="$(cast call "$PUSD" "allowance(address,address)(uint256)" "$EOA" "$POOL" --rpc-url "$RPC" | awk '{print $1}' | sed 's/_.*$//')"
if [ -z "$allowance" ] || [ "$(printf '%s\n%s\n' "$allowance" "$threshold" | sort -n | head -1)" = "$allowance" ] && [ "$allowance" != "$threshold" ]; then
  echo
  echo "==> Step 2: approve pool to spend 100 pUSD"
  send_async_and_wait "approve" \
    "$PUSD" "approve(address,uint256)" "$POOL" 100000000000000000000
else
  echo
  echo "==> Step 2: allowance already sufficient, skipping approve"
fi

# --- Step 3: supply 50 pUSD -------------------------------------------------
echo
echo "==> Step 3: supply 50 pUSD"
send_async_and_wait "supply" \
  "$POOL" "supply(address,uint256)" "$PUSD" 50000000000000000000

# --- Step 4: BENIGN withdraw (this is the workflow's trigger) ---------------
echo
echo "==> Step 4: BENIGN withdraw 1 pUSD  <-- caught by Phulax workflow"
send_async_and_wait "withdraw/benign" \
  "$POOL" "withdraw(address,uint256,address)" "$PUSD" 1000000000000000000 "$EOA"

echo
echo "Done. Watch the workflow run in KH; expected outcome: no fire."
echo "  ssh root@\$PHULAX_HOST 'cd /opt/phulax && docker compose logs -f keeperhub | grep -iE \"workflow|detect|classify|decide\"'"
echo "  https://\$PHULAX_HOST/  →  Workflows → Phulax Guardian → most recent run"

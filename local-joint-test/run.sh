#!/usr/bin/env bash
set -e

echo "======================================================================"
echo "  Web3 Chat Protocol: Local Joint Integration Test (Contract & Worker)"
echo "======================================================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACT_ROOT="/ssd0/git/web3-chat-contract"

# 1. Check required tools
command -v anvil >/dev/null 2>&1 || { echo >&2 "[ERROR] anvil is not installed or not in PATH. Please ensure Foundry is installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo >&2 "[ERROR] pnpm is not installed. Please install pnpm."; exit 1; }

# 2. Check contract compilation artifacts
if [ ! -d "$CONTRACT_ROOT/out/ChatStorageFactory.sol" ]; then
  echo "[INFO] Smart contract artifacts not found in $CONTRACT_ROOT/out. Compiling..."
  cd "$CONTRACT_ROOT"
  pnpm run compile
  cd "$WORKER_ROOT"
fi

# 3. Clean up any hanging anvil instances on port 8547
echo "[INFO] Ensuring port 8547 is clear..."
fuser -k 8547/tcp >/dev/null 2>&1 || true

# 4. Run the joint test suite with Vitest
echo "[INFO] Running 9-stage joint integration test against local Anvil..."
cd "$WORKER_ROOT"
pnpm vitest run "$SCRIPT_DIR/joint.test.ts"

echo "======================================================================"
echo "  [SUCCESS] Local Joint Integration Test Completed Successfully!"
echo "======================================================================"

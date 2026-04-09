#!/usr/bin/env bash
# deploy-staging.sh — Tenant Core Staging Deploy
#
# Usage:
#   bash deploy-staging.sh              # full deploy + smoke tests
#   bash deploy-staging.sh --no-tests   # deploy, skip smoke tests
#   bash deploy-staging.sh --dry-run    # print every step, change nothing
#   bash deploy-staging.sh --force      # deploy even with a dirty working tree
#
# Requirements (Git Bash on Windows + Linux compatible):
#   ssh, scp, tar, curl  — standard in Git Bash and Linux
#   rsync                — used automatically when available, falls back to tar+scp

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────

readonly SERVER="deploy@46.225.102.88"
readonly SSH_KEY="$HOME/.ssh/id_ed25519_hetzner"
readonly REMOTE_COMPOSE_DIR="/opt/voice-saas-staging"
readonly REMOTE_APP_DIR="$REMOTE_COMPOSE_DIR/tenant-core"
readonly COMPOSE_SERVICE="tenant-core"
readonly CONTAINER_NAME="voice_staging_tenant_core"
readonly HEALTH_URL="https://staging.am-gastro-intelligence-gmbh.de/tenant-core/api/health"
readonly HEALTH_TIMEOUT=60   # seconds total
readonly HEALTH_INTERVAL=2   # seconds between checks

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly BACKEND_DIR="$SCRIPT_DIR/backend"
readonly TEST_DIR="$SCRIPT_DIR/test-engine-v2"

# ── Colors (only when stdout is a terminal) ───────────────────────────────────

if [ -t 1 ]; then
  C_RESET='\033[0m'
  C_BOLD='\033[1m'
  C_GREEN='\033[0;32m'
  C_RED='\033[0;31m'
  C_YELLOW='\033[0;33m'
  C_CYAN='\033[0;36m'
  C_DIM='\033[2m'
else
  C_RESET='' C_BOLD='' C_GREEN='' C_RED='' C_YELLOW='' C_CYAN='' C_DIM=''
fi

# ── Logging ───────────────────────────────────────────────────────────────────

log()     { echo -e "${C_CYAN}[$(date '+%H:%M:%S')]${C_RESET} $*"; }
log_ok()  { echo -e "${C_GREEN}[$(date '+%H:%M:%S')] ✔ $*${C_RESET}"; }
log_warn(){ echo -e "${C_YELLOW}[$(date '+%H:%M:%S')] ⚠ $*${C_RESET}"; }
fail()    { echo -e "${C_RED}[$(date '+%H:%M:%S')] ✘ FAIL: $*${C_RESET}" >&2; exit 1; }
drylog()  { echo -e "${C_DIM}[$(date '+%H:%M:%S')] [dry-run] $*${C_RESET}"; }

# Log a phase header with optional timing
_PHASE_START=0
phase() {
  _PHASE_START=$(date +%s 2>/dev/null || echo 0)
  echo ""
  echo -e "${C_BOLD}${C_CYAN}── $* ─────────────────────────────────────────────${C_RESET}"
}

phase_ok() {
  local _end
  _end=$(date +%s 2>/dev/null || echo 0)
  local _dur=$(( _end - _PHASE_START ))
  log_ok "$* ${C_DIM}(${_dur}s)${C_RESET}"
}

# ── Flag parsing ──────────────────────────────────────────────────────────────

DRY_RUN=false
RUN_TESTS=true
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=true ;;
    --no-tests) RUN_TESTS=false ;;
    --force)    FORCE=true ;;
    --help|-h)
      echo "Usage: bash deploy-staging.sh [--no-tests] [--dry-run] [--force]"
      exit 0 ;;
    *)
      fail "Unknown flag: $arg  (use --help)"
      ;;
  esac
done

# ── SSH helper ────────────────────────────────────────────────────────────────

# ssh_run <command>  — run a remote command; prints in dry-run, executes otherwise
ssh_run() {
  if $DRY_RUN; then
    drylog "ssh: $*"
  else
    ssh -i "$SSH_KEY" \
      -o StrictHostKeyChecking=no \
      -o BatchMode=yes \
      -o ConnectTimeout=10 \
      "$SERVER" "$@"
  fi
}

# local_run <command>  — run a local command; prints in dry-run, executes otherwise
local_run() {
  if $DRY_RUN; then
    drylog "$*"
  else
    eval "$@"
  fi
}

# ── Deploy start ──────────────────────────────────────────────────────────────

DEPLOY_START=$(date +%s 2>/dev/null || echo 0)

GIT_HASH=$(git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
DEPLOY_TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')

echo ""
echo -e "${C_BOLD}${C_CYAN}════════════════════════════════════════════════════${C_RESET}"
echo -e "${C_BOLD}  Staging Deploy — Tenant Core${C_RESET}"
echo -e "  commit  : ${C_BOLD}$GIT_HASH${C_RESET}  ($GIT_BRANCH)"
echo -e "  server  : $SERVER"
echo -e "  target  : $REMOTE_APP_DIR"
echo -e "  started : $DEPLOY_TIMESTAMP"
$DRY_RUN  && echo -e "  ${C_YELLOW}mode    : DRY-RUN — no changes will be made${C_RESET}"
$RUN_TESTS || echo -e "  tests   : skipped (--no-tests)"
$FORCE     && echo -e "  ${C_YELLOW}guard   : --force — git check bypassed${C_RESET}"
echo -e "${C_BOLD}${C_CYAN}════════════════════════════════════════════════════${C_RESET}"

# ─────────────────────────────────────────────────────────────────────────────
# Phase 0: Git guard
# ─────────────────────────────────────────────────────────────────────────────
phase "Phase 0 · Git guard"

if $FORCE; then
  log_warn "--force set — skipping git clean check"
else
  DIRTY=$(git -C "$SCRIPT_DIR" status --porcelain 2>/dev/null || echo "")
  if [ -n "$DIRTY" ]; then
    echo -e "${C_YELLOW}Uncommitted changes:${C_RESET}"
    echo "$DIRTY" | head -20
    fail "Working tree is dirty. Commit your changes first, or re-run with --force."
  fi
  log "Working tree is clean"
fi

phase_ok "Git guard"

# ─────────────────────────────────────────────────────────────────────────────
# Phase 1: Local build
# ─────────────────────────────────────────────────────────────────────────────
phase "Phase 1 · Local build"

[ -d "$BACKEND_DIR" ] || fail "backend/ not found at $BACKEND_DIR"

log "npm ci ..."
# npm ci is preferred (reproducible). On Windows/Git Bash it can fail with
# permissions errors when node_modules files are locked → fall back to npm install.
local_run "cd '$BACKEND_DIR' && (npm ci --prefer-offline 2>&1 || npm install --prefer-offline 2>&1) | tail -4"

log "npm run build ..."
local_run "cd '$BACKEND_DIR' && npm run build"

phase_ok "Local build"

# ─────────────────────────────────────────────────────────────────────────────
# Phase 2: Transfer dist to server
# ─────────────────────────────────────────────────────────────────────────────
phase "Phase 2 · Transfer  →  $REMOTE_APP_DIR"

USED_RSYNC=false

if command -v rsync &>/dev/null; then
  log "Transport: rsync"

  # Upload to dist.new/ to allow atomic swap later
  local_run "rsync -az --delete \
    -e 'ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o BatchMode=yes' \
    '$BACKEND_DIR/dist/' \
    '$SERVER:$REMOTE_APP_DIR/dist.new/'"

  local_run "rsync -az \
    -e 'ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o BatchMode=yes' \
    '$BACKEND_DIR/package.json' \
    '$BACKEND_DIR/package-lock.json' \
    '$SERVER:$REMOTE_APP_DIR/'"

  USED_RSYNC=true
else
  log "Transport: tar + scp  (rsync not available)"

  TMPTAR="/tmp/tenant-core-deploy-${GIT_HASH}.tar.gz"

  if ! $DRY_RUN; then
    tar -czf "$TMPTAR" \
      -C "$BACKEND_DIR" \
      dist package.json package-lock.json \
    || fail "tar failed"

    TAR_SIZE=$(du -sh "$TMPTAR" | cut -f1)
    log "Archive: $TMPTAR  ($TAR_SIZE)"

    scp -i "$SSH_KEY" \
      -o StrictHostKeyChecking=no \
      -o BatchMode=yes \
      -q \
      "$TMPTAR" \
      "$SERVER:$REMOTE_APP_DIR/dist-deploy.tar.gz" \
    || fail "scp failed"

    rm -f "$TMPTAR"
  else
    drylog "tar -czf $TMPTAR -C $BACKEND_DIR dist package.json package-lock.json"
    drylog "scp $TMPTAR $SERVER:$REMOTE_APP_DIR/dist-deploy.tar.gz"
  fi
fi

phase_ok "Transfer"

# ─────────────────────────────────────────────────────────────────────────────
# Phase 3: Server-side swap
#
# Docker ownership problem:
#   Files written by the container run as the node user (UID 1000).
#   The host deploy user cannot rm them directly.
#   Solution:  docker exec  to delete from inside the running container.
#   Fallback:  docker compose stop  so the kernel releases the files,
#              then use a temporary node:20-alpine container to delete.
# ─────────────────────────────────────────────────────────────────────────────
phase "Phase 3 · Server swap + container recreate"

if ! $DRY_RUN; then
  log "Removing old dist/ (handling Docker-user ownership) ..."

  CLEANUP_OK=false

  # Primary: docker exec into the running container
  if ssh_run "docker exec $CONTAINER_NAME sh -c 'rm -rf /app/dist' 2>/dev/null"; then
    log "Old dist/ removed via docker exec"
    CLEANUP_OK=true
  fi

  # Fallback: stop container, then use a temp container as node user to delete
  if ! $CLEANUP_OK; then
    log_warn "docker exec failed — stopping container and using temp cleanup container"
    ssh_run "cd $REMOTE_COMPOSE_DIR && docker compose stop $COMPOSE_SERVICE 2>&1 | tail -2" || true
    ssh_run "docker run --rm \
      -v $REMOTE_APP_DIR:/app \
      node:20-alpine \
      sh -c 'rm -rf /app/dist'" \
    || fail "Fallback dist cleanup failed"
    log "Old dist/ removed via temp container"
  fi

  # Place new dist
  if $USED_RSYNC; then
    ssh_run "cd $REMOTE_APP_DIR && rm -rf dist && mv dist.new dist"
    log "dist.new → dist"
  else
    ssh_run "cd $REMOTE_APP_DIR \
      && tar -xzf dist-deploy.tar.gz \
      && rm dist-deploy.tar.gz"
    log "Archive extracted into $REMOTE_APP_DIR"
  fi

  # Write commit tracking file
  ssh_run "echo '$GIT_HASH ($GIT_BRANCH) - $DEPLOY_TIMESTAMP' \
    > $REMOTE_APP_DIR/.deployed-commit"
  log "Commit recorded → $REMOTE_APP_DIR/.deployed-commit"

  # Force-recreate so the container always picks up new dist files.
  # --force-recreate ensures restart even when compose config is unchanged.
  log "docker compose up -d --force-recreate $COMPOSE_SERVICE ..."
  ssh_run "cd $REMOTE_COMPOSE_DIR \
    && docker compose up -d --force-recreate $COMPOSE_SERVICE 2>&1 \
    | grep -v '^time=' | tail -6"

else
  drylog "docker exec $CONTAINER_NAME rm -rf /app/dist"
  drylog "  [fallback] docker compose stop + temp node container"
  if $USED_RSYNC; then
    drylog "mv $REMOTE_APP_DIR/dist.new $REMOTE_APP_DIR/dist"
  else
    drylog "tar -xzf dist-deploy.tar.gz in $REMOTE_APP_DIR"
  fi
  drylog "echo '$GIT_HASH ...' > $REMOTE_APP_DIR/.deployed-commit"
  drylog "cd $REMOTE_COMPOSE_DIR && docker compose up -d --force-recreate $COMPOSE_SERVICE"
fi

phase_ok "Server swap + container recreate"

# ─────────────────────────────────────────────────────────────────────────────
# Phase 4: Health check
# ─────────────────────────────────────────────────────────────────────────────
phase "Phase 4 · Health check"
log "Polling $HEALTH_URL  (timeout: ${HEALTH_TIMEOUT}s, interval: ${HEALTH_INTERVAL}s)"

if ! $DRY_RUN; then
  elapsed=0
  HTTP_CODE="000"

  while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    HTTP_CODE=$(
      curl -s -o /dev/null -w "%{http_code}" \
        --max-time 4 \
        "$HEALTH_URL" \
        2>/dev/null \
      || echo "000"
    )

    if [ "$HTTP_CODE" = "200" ]; then
      break
    fi

    if [ "$elapsed" -eq 0 ]; then
      log "HTTP $HTTP_CODE — container starting ..."
    else
      log "HTTP $HTTP_CODE — ${elapsed}s / ${HEALTH_TIMEOUT}s ..."
    fi

    sleep "$HEALTH_INTERVAL"
    elapsed=$(( elapsed + HEALTH_INTERVAL ))
  done

  if [ "$HTTP_CODE" != "200" ]; then
    # Print last container logs to help diagnose
    log_warn "Fetching container logs for diagnostics ..."
    ssh_run "docker logs $CONTAINER_NAME 2>&1 | tail -20" || true
    fail "Health check failed after ${HEALTH_TIMEOUT}s  (last HTTP: $HTTP_CODE)"
  fi

  log_ok "HTTP 200 after ${elapsed}s"
else
  drylog "curl $HEALTH_URL  → expect 200"
fi

phase_ok "Health check"

# ─────────────────────────────────────────────────────────────────────────────
# Phase 5: Smoke tests (optional)
# ─────────────────────────────────────────────────────────────────────────────
phase "Phase 5 · Smoke tests"

if $RUN_TESTS; then
  [ -d "$TEST_DIR" ] || fail "test-engine-v2/ not found at $TEST_DIR"

  # Install cross-env if the node_modules is stale / missing
  if ! $DRY_RUN; then
    if ! (cd "$TEST_DIR" && node -e "require('cross-env')" 2>/dev/null); then
      log "Installing test-engine-v2 dependencies ..."
      (cd "$TEST_DIR" && npm install --prefer-offline 2>&1 | tail -4)
    fi
  fi

  local_run "cd '$TEST_DIR' && npm run test:staging -- --forceExit"
  phase_ok "Smoke tests"
else
  log "Skipped (--no-tests)"
  phase_ok "Smoke tests (skipped)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────

DEPLOY_END=$(date +%s 2>/dev/null || echo "$DEPLOY_START")
DEPLOY_DUR=$(( DEPLOY_END - DEPLOY_START ))

echo ""
echo -e "${C_BOLD}${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo -e "${C_BOLD}${C_GREEN}  Deploy complete${C_RESET}"
echo -e "  commit   : ${C_BOLD}$GIT_HASH${C_RESET}  ($GIT_BRANCH)"
echo -e "  duration : ${C_BOLD}${DEPLOY_DUR}s${C_RESET}"
echo -e "  health   : $HEALTH_URL"
$DRY_RUN && echo -e "  ${C_YELLOW}(dry-run — no changes were made)${C_RESET}"
echo -e "${C_BOLD}${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo ""

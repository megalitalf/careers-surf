#!/usr/bin/env bash
# scraper/scrape.sh
# ─────────────────
# Cron-safe wrapper for run-cities.js.
# Ensures the correct PATH, Node.js version, and AWS credentials are available
# before launching the scraper — cron environments are minimal and often lack
# these by default.
#
# Cron example (every 4 hours):
#   0 */4 * * *  cd /path/to/careers-surf && bash scraper/scrape.sh >> scraper/cron.log 2>&1
#
# On-demand:
#   bash scraper/scrape.sh
#   bash scraper/scrape.sh --cities Warsaw --pages 2
#   bash scraper/scrape.sh --dry-run

set -euo pipefail

# ── Resolve script / project dirs ─────────────────────────────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  careers-surf scraper  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "  project : $PROJECT_DIR"
echo "  scraper : $SCRIPT_DIR"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── PATH — pick up nvm / fnm / homebrew node even inside cron ─────────────────
# Add common node locations; adjust if your setup differs.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(cat "$HOME/.nvmrc" 2>/dev/null || echo 'current')/bin:$HOME/.fnm/current/bin:$PATH"

# Verify node is available
if ! command -v node &>/dev/null; then
  echo "❌  node not found in PATH. Adjust PATH in $BASH_SOURCE"
  exit 1
fi
echo "  node : $(node --version)  ($(command -v node))"

# ── AWS credentials ────────────────────────────────────────────────────────────
# Option 1 (recommended): IAM role / instance profile — nothing to set here.
# Option 2: set in a local .env file that is NOT committed to git.
#   S3_BUCKET=careers-surf-data
#   AWS_REGION=eu-north-1
#   AWS_ACCESS_KEY_ID=...
#   AWS_SECRET_ACCESS_KEY=...
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  echo "  env  : loading $ENV_FILE"
  set -o allexport
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +o allexport
fi

# Required: S3_BUCKET must be set
if [ -z "${S3_BUCKET:-}" ]; then
  echo "⚠   S3_BUCKET is not set — scrape will run locally only (no S3 upload)"
fi

# Optional proxy — set SCRAPER_PROXY_URL in .env to route through a proxy
if [ -n "${SCRAPER_PROXY_URL:-}" ]; then
  echo "  proxy: SCRAPER_PROXY_URL is set"
fi

echo ""

# ── Run ────────────────────────────────────────────────────────────────────────
cd "$PROJECT_DIR"
exec node "$SCRIPT_DIR/run-cities.js" "$@"

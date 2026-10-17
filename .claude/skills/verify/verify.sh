#!/usr/bin/env bash
# Runs PitchMate's CI gates locally and prints a pass/fail summary.
# Usage: verify.sh [all|backend|web]   (default: all)
set -uo pipefail

scope="${1:-all}"
case "$scope" in all|backend|web) ;; *) echo "usage: $0 [all|backend|web]" >&2; exit 2 ;; esac

cd "$(git rev-parse --show-toplevel)" || exit 2
logs="$(mktemp -d)"
names=()
results=()
failed=0

# gate <name> <command...>: runs the command, logging to $logs/<name>.log.
gate() {
  local name="$1"; shift
  printf '%-22s ' "$name"
  if "$@" >"$logs/$name.log" 2>&1; then
    echo "PASS"; names+=("$name"); results+=("PASS")
  else
    echo "FAIL  (log: $logs/$name.log)"; names+=("$name"); results+=("FAIL"); failed=1
    tail -n 30 "$logs/$name.log" | sed 's/^/    /'
  fi
}

# A regenerated file must match the index: unstaged drift means it was regenerated but not committed.
unstaged_clean() {
  git diff --exit-code -- "$1"
}

docker_up() {
  docker info >/dev/null 2>&1 || { echo "Docker is not running (Testcontainers needs it). On macOS: open -a Docker"; return 1; }
}

if [[ "$scope" == all || "$scope" == backend ]]; then
  gate backend-build      dotnet build backend/PitchMate.slnx --configuration Release
  gate openapi-spec-sync  unstaged_clean packages/api-client/openapi/v1.json
  gate docker             docker_up
  gate backend-test       dotnet test backend/PitchMate.slnx --configuration Release --no-build
fi

if [[ "$scope" == all || "$scope" == web ]]; then
  gate api-client-gen     npm run gen --workspace @pitchmate/api-client
  gate api-client-sync    unstaged_clean packages/api-client/src/schema.d.ts
  gate web-lint           npm run lint
  gate web-build          npm run build
  gate web-test           npm test --workspace @pitchmate/web
fi

echo
echo "Summary ($scope):"
for i in "${!names[@]}"; do printf '  %-22s %s\n' "${names[$i]}" "${results[$i]}"; done
exit "$failed"

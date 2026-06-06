# Source this file to make `premo` available in the current shell only.
#
#   source /path/to/premo/bin/activate.sh
#
# Defines two shell functions:
#   premo              — invoke the CLI from any directory
#   premo-deactivate   — remove both functions from the current shell
#
# Nothing is written to disk, $PATH, or any rc file. Exiting the shell
# cleans everything up automatically.

# This file must be SOURCED, not executed — it defines functions in your shell.
# Bail with guidance if it was run directly (which would also misparse under sh).
_premo_sourced=0
if [ -n "$ZSH_VERSION" ]; then
  case "$ZSH_EVAL_CONTEXT" in *:file*) _premo_sourced=1 ;; esac
elif [ -n "$BASH_VERSION" ]; then
  [ "${BASH_SOURCE[0]}" != "$0" ] && _premo_sourced=1
fi
if [ "$_premo_sourced" = 0 ]; then
  echo "premo: source this file, don't run it:" >&2
  echo "  source ${BASH_SOURCE[0]:-$0}" >&2
  echo "(it defines a 'premo' function in your current shell; zsh or bash)" >&2
  exit 1
fi
unset _premo_sourced

# Resolve the premo repo root regardless of caller's cwd. Works under
# bash (uses BASH_SOURCE) and zsh (falls back to $0 when sourced).
_premo_self="${BASH_SOURCE[0]:-$0}"
_PREMO_DIR="$(cd "$(dirname "$_premo_self")/.." && pwd)"
unset _premo_self

if [ ! -x "$_PREMO_DIR/node_modules/.bin/tsx" ]; then
  echo "premo: tsx not found at $_PREMO_DIR/node_modules/.bin/tsx" >&2
  echo "premo: run 'yarn install' in $_PREMO_DIR first." >&2
  unset _PREMO_DIR
  return 1 2>/dev/null || exit 1
fi

premo() {
  "$_PREMO_DIR/node_modules/.bin/tsx" "$_PREMO_DIR/bin/premo.ts" "$@"
}

premo-deactivate() {
  unset -f premo premo-deactivate
  unset _PREMO_DIR
  echo "premo deactivated."
}

# Best-effort: load shell completion so it matches the installed experience.
# Any failure here is swallowed and never breaks sourcing. Note: in source mode
# each TAB pays tsx startup, so completion is a touch slower than when installed.
if [ -n "$ZSH_VERSION" ]; then
  if ! command -v compdef >/dev/null 2>&1; then
    autoload -Uz compinit 2>/dev/null && compinit -u 2>/dev/null
  fi
  eval "$(premo completion zsh 2>/dev/null)" 2>/dev/null
elif [ -n "$BASH_VERSION" ]; then
  eval "$(premo completion bash 2>/dev/null)" 2>/dev/null
fi

echo "premo activated from $_PREMO_DIR"
echo "  run 'premo doctor' to verify, 'premo-deactivate' to remove."

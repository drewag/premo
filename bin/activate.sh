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

echo "premo activated from $_PREMO_DIR"
echo "  run 'premo doctor' to verify, 'premo-deactivate' to remove."

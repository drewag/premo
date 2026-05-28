# Source this file to make `strand` available in the current shell only.
#
#   source /path/to/strand/bin/activate.sh
#
# Defines two shell functions:
#   strand              — invoke the CLI from any directory
#   strand-deactivate   — remove both functions from the current shell
#
# Nothing is written to disk, $PATH, or any rc file. Exiting the shell
# cleans everything up automatically.

# Resolve the strand repo root regardless of caller's cwd. Works under
# bash (uses BASH_SOURCE) and zsh (falls back to $0 when sourced).
_strand_self="${BASH_SOURCE[0]:-$0}"
_STRAND_DIR="$(cd "$(dirname "$_strand_self")/.." && pwd)"
unset _strand_self

if [ ! -x "$_STRAND_DIR/node_modules/.bin/tsx" ]; then
  echo "strand: tsx not found at $_STRAND_DIR/node_modules/.bin/tsx" >&2
  echo "strand: run 'yarn install' in $_STRAND_DIR first." >&2
  unset _STRAND_DIR
  return 1 2>/dev/null || exit 1
fi

strand() {
  "$_STRAND_DIR/node_modules/.bin/tsx" "$_STRAND_DIR/bin/strand.ts" "$@"
}

strand-deactivate() {
  unset -f strand strand-deactivate
  unset _STRAND_DIR
  echo "strand deactivated."
}

echo "strand activated from $_STRAND_DIR"
echo "  run 'strand doctor' to verify, 'strand-deactivate' to remove."

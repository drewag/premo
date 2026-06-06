# Printed by `premo dev` inside the premo repo. premo is a CLI, not a server —
# there's nothing to "run" in dev — so this explains how to put THIS checkout on
# your path instead, which is what a developer here actually wants.
dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cat <<EOF
premo is a CLI — there's no dev server to start.

To use THIS checkout's premo from any directory (live, via tsx):

  source $dir/bin/activate.sh

That defines a 'premo' shell function and loads tab-completion. Add the same
line to your ~/.zshrc (or ~/.bashrc) to make it permanent; run
'premo-deactivate' to remove it from the current shell.

Or, to put a compiled build of this checkout on your PATH globally:

  yarn build && npm link     # 'premo' -> this repo's dist (rebuild after edits)
EOF

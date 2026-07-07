Default branch is `master`.

## Project — Trigger Code Snippets

A personal-use **Manifest V3 Chrome extension** that stores JavaScript snippets and runs them in the page's main world via `chrome.debugger` (DevTools-Snippets style), triggered by `Alt+Shift+1`–`9`, the toolbar popup, or the right-click context menu.

- **Vanilla JS, no build step, no package manager.** Pure ES modules (`background.js`, `popup/`, `manager/`, `shared/`) plus one IIFE content script (`content.js`). The Python/`uv` and Node/`pnpm` rules below do **not** apply here — there is nothing to install or build.
- **Run/test it:** `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder. Reload the extension after edits (and reload the target page for `content.js` changes).
- **Storage:** snippets live in `chrome.storage.local` under the `snippets` key; `shared/storage.js` is the single storage layer (imported by background/popup/manager — `content.js` messages the service worker instead).
- **Execution:** snippets run via `chrome.debugger` (CDP `Runtime.evaluate`), which is what bypasses page CSP; the `scripting` permission is declared but currently unused (retained for future scripting work, not dead weight).
- **Permissions:** the manifest declares a broad 30-permission set (as of v1.1.0). Only `offscreen` (clipboard for the "List all tab URLs" toolbar action) and `tabs` are exercised in code today; the other ~25 are **intentionally pre-loaded** for near-term automation/accessibility work, not accreted dead weight. Prefer pre-loading over churning the manifest per feature; do not prune without checking with the owner.
- **Defaults:** `defaults/default-snippets.json` is a first-install-only seed copied from `~/CODE/CaptainCodeAU/SCRIPTS/devtools-snippets` (top-level files = latest; `archive/` = retired). Treat that repo as **read-only**.
- **Spec:** `docs/SPEC.md` is the as-built architecture / ADR / roadmap reference.

## Python

Use `uv run python3` instead of calling `python3` directly. (A shell wrapper intercepts bare `python`/`python3` and version-specific calls like `py313`/`py312` and redirects to `uv run` — but invoke `uv run` directly rather than relying on the wrapper, since non-interactive Bash-tool shells skip `.zshrc` and the wrapper is absent there.)
For standalone scripts needing third-party libs, use PEP 723 inline metadata (`# /// script` block) — `uv run` resolves it automatically.
Package management is `uv`, not pip/pipx: use `uv add` / `uv remove` (not `pip install` / `pip uninstall`), and `uv tool` (not `pipx`). The same wrapper-absence caveat applies — in the Bash tool, `pip install` hits real pip, so call `uv` directly.

## Node / JS package manager

Never use `npm` or `yarn`. Use `pnpm` (or `bun`). Pick by lockfile:

- `pnpm-lock.yaml` present → use pnpm.
- `bun.lockb` / `bun.lock` present → use bun.
- No lockfile → default to pnpm.
- Only `package-lock.json` or `yarn.lock` present → disregard them, use pnpm anyway (do not run npm/yarn to honor them).
  For one-off package execution prefer `pnpm dlx` over `npx`.

## Source files — encoding

Emit only ASCII punctuation in source code: straight quotes (`"` `'`), straight apostrophes, and hyphen-minus (`-`). Never write Unicode smart quotes (`“ ” ‘ ’`), en/em dashes (`– —`), or other Unicode punctuation into code files — they pass type-checks but break the build at transform time (the JS/TS build rejects them), and hunting them down afterward wastes a session. Unicode is fine in comments, docs, and string literals meant for display; never in identifiers, keys, or code tokens.

## Shell

Shell has `NULL_GLOB` + `nonomatch` — use `find -print` (not `ls glob*`) for file existence checks.
For port listing use the `ports` function (OS-aware: `lsof` on macOS, `ss`/`netstat` on Linux/WSL) rather than calling those tools directly.

Never start a Bash command with `cd` — the harness hard-rejects any leading `cd` (it tells you to use `git -C <path>`, an absolute path, or `builtin cd`). This is a built-in Claude Code guard, not a repo hook. Treat the rejection as a signal to change the command _shape_ (reach for `git -C`/absolute paths), not to retry the same `cd`-prefixed command. A rejected `cd` exits non-zero, so if it was batched with sibling calls it cancels all of them (see next paragraph) — which reads as a "stuck loop" but is really one repeated mistake.

A non-zero exit from any Bash call cancels the other tool calls batched in the same message (Claude Code aborts parallel siblings on error). Never batch state-changing commands (`git add`/`commit`/`push`, file writes) in the same message as read-only probes — a probe that exits non-zero (e.g. `ls`/`grep`/`cat` on a missing path) silently cancels the mutation, so a commit can vanish with no error you'd notice. Sequence mutations as their own calls, and prefer `find -print` (exits 0 when nothing matches) over `ls`/`grep` for existence checks.

## Editing

Before editing a file, run `grep -cP '\t' <file>` to detect tab indentation — match exactly or the Edit tool will fail.

## Deletion safety

`rm`, `cp`, and `mv` are shell-function wrappers with safety behavior (rm routes to trash; cp/mv default to `-i` overwrite prompts). These wrappers are NEVER active in Bash tool calls — non-interactive shells skip `.zshrc`, so any `rm`/`cp`/`mv` here hits `/bin/rm` etc. directly: deletions are permanent and overwrites are silent. Always get explicit user confirmation before deleting or overwriting files. A `~/.config/safe-rm` denylist exists but does NOT protect you in the Bash tool either — don't rely on it.

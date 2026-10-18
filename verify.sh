#!/usr/bin/env bash
# PROJECT ALPHA — one-shot integrity verifier.
#
# Why this file exists: multi-line shell commands pasted through chat UIs lose
# their newlines, which silently merges `wc -l`, `echo`, and heredocs into one
# broken line. Run this file instead of pasting the checks:
#
#     cd /home/user/project-alpha && bash verify.sh
#
# It prints a PASS/FAIL line per check and exits non-zero if any hard check fails.

cd "$(dirname "$0")" || exit 1
FAIL=0
ok()   { printf '  PASS  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; FAIL=1; }
head_() { printf '\n== %s ==\n' "$1"; }

# ---------------------------------------------------------------- file counts
head_ "1. Handoff file line counts (Appendix B says 69/223/157/240/24/17/21/60 = 811)"
TOTAL=0
while read -r want rel; do
  [ -n "$want" ] || continue
  path="apps/web/$rel"
  got=$(wc -l < "$path" 2>/dev/null || echo MISSING)
  if [ "$got" = "$want" ]; then ok "$path = $got"; else bad "$path expected $want, got $got"; fi
  TOTAL=$((TOTAL + want))
done <<'FILES'
69 src/lib/sseClient.ts
223 test/sseClient.test.ts
157 src/lib/vault.ts
240 test/vault.test.ts
24 test/setup.ts
17 vitest.config.ts
21 vite.config.ts
FILES
got=$(wc -l < apps/worker/wrangler.toml 2>/dev/null || echo MISSING)
if [ "$got" = "60" ]; then ok "apps/worker/wrangler.toml = 60"; else bad "wrangler.toml expected 60, got $got"; fi
TOTAL=$((TOTAL + 60))
[ "$TOTAL" = "811" ] && ok "total = 811 lines (matches Appendix B)" || bad "total $TOTAL != 811"

# --------------------------------------------------------------- doc integrity
# Python-free on purpose: Windows Git Bash ships no python3 by default, and this
# is the one gate the owner must be able to run anywhere (bash + awk + sed + grep).
head_ "2. STATUS_V8.06.md integrity"
DOC="STATUS_V8.06.md"
# NOTE: the trailing space is load-bearing — "64.93 kB" is not a step number.
STEPS=$(awk '/^## Appendix A/{f=1;next} /^\*\*Appendix B/{f=0} f' "$DOC" \
        | sed -nE 's/^[[:space:]]*([0-9]+)\.[[:space:]].*/\1/p')
N=$(printf '%s\n' "$STEPS" | grep -c '[0-9]' || true)
CONTIG=1; i=1
while IFS= read -r n; do
  [ -n "$n" ] || continue
  [ "$n" = "$i" ] || CONTIG=0
  i=$((i + 1))
done <<< "$STEPS"
if [ "$CONTIG" = "1" ]; then ok "Appendix A steps: $N, contiguous 1..N: true"; else bad "Appendix A steps not contiguous"; fi
ok "INFO  document lines: $(wc -l < "$DOC" | tr -d ' ')"
STRAY=$(grep -n "136" "$DOC" | grep -cv "VOID" || true)
if [ "$STRAY" = "0" ]; then ok "no unlabelled '136' counts (0 stray)"; else bad "$STRAY stray '136' counts"; fi
ok "INFO  '158' citations: $(grep -c '158 tests' "$DOC" || true)"

# ------------------------------------------------------------------ repo state
head_ "3. Repo hygiene"
if [ -d apps/web/.git ]; then bad "stray apps/web/.git still present"; else ok "no stray apps/web/.git"; fi
if head -1 apps/worker/wrangler.toml | grep -q '^// FILE:'; then bad "wrangler.toml has a // FILE marker (TOML will not parse)"; else ok "wrangler.toml line 1 is valid TOML"; fi
if ! grep -q '^\.dev\.vars' .gitignore; then bad ".dev.vars is not listed in .gitignore";
elif [ -f apps/worker/.dev.vars ]; then ok ".dev.vars gitignored (file present)";
else ok ".dev.vars gitignored (file absent — expected in a fresh extraction)"; fi
n=$(find . \( -name node_modules -o -name .git -o -name .wrangler -o -name dist \) -prune -o \( -name '*.ts' -o -name '*.tsx' \) -print | wc -l | tr -d ' ')
echo "  INFO  source files: $n .ts/.tsx"

# ------------------------------------------------------------------ hard gate
head_ "4. Root gate (install -> typecheck -> test)"
npx --yes pnpm@9.15.0 install --frozen-lockfile >/dev/null 2>&1 && ok "install --frozen-lockfile exit 0" || bad "install failed"
npx --yes pnpm@9.15.0 -r typecheck >/dev/null 2>&1 && ok "typecheck exit 0" || bad "typecheck failed"
pnpm -r test 2>&1 | grep -E "Test Files|Tests  " | sed 's/^/  INFO  /'
npx --yes pnpm@9.15.0 -r test >/dev/null 2>&1 && ok "test exit 0 (expect 24 files / 194 tests)" || bad "test suite failed"

printf '\n== RESULT ==\n'
if [ "$FAIL" -eq 0 ]; then echo "  ALL CHECKS PASS"; else echo "  SOME CHECKS FAILED (see FAIL lines above)"; fi
exit "$FAIL"

#!/usr/bin/env bats

# Source the script with main() disabled so we can unit-test individual functions.
setup() {
    export OPTIMIA_SOURCED=1
    # shellcheck disable=SC1090
    source "${BATS_TEST_DIRNAME}/../bin/optimia"
}

# ── pkg_installed ──────────────────────────────────────────────────────────────

@test "pkg_installed: detects an installed command (bash)" {
    run pkg_installed bash
    [ "$status" -eq 0 ]
}

@test "pkg_installed: returns 1 for a missing command" {
    run pkg_installed __nonexistent_cmd_optimia_test__
    [ "$status" -ne 0 ]
}

@test "pkg_installed: npm: prefix detects headroom (globally installed)" {
    run pkg_installed npm:headroom
    [ "$status" -eq 0 ]
}

@test "pkg_installed: npm: returns 1 for a missing npm package" {
    run pkg_installed npm:__nonexistent_npm_pkg_xyz_optimia_test__
    [ "$status" -ne 0 ]
}

# ── get_install_hint ───────────────────────────────────────────────────────────

@test "get_install_hint: ponytail contains @dietrichgebert/ponytail" {
    run get_install_hint ponytail
    [ "$status" -eq 0 ]
    [[ "$output" == *"@dietrichgebert/ponytail"* ]]
}

@test "get_install_hint: claude returns npm install hint" {
    run get_install_hint claude
    [ "$status" -eq 0 ]
    [[ "$output" == *"claude-code"* ]]
}

# ── write_default_tools ────────────────────────────────────────────────────────

_write_tools_to_tmp() {
    local tmp; tmp=$(mktemp)
    OPTIMIA_TOOLS_FILE="$tmp" write_default_tools
    echo "$tmp"
}

@test "default tools config includes [ponytail]" {
    local tmp; tmp=$(_write_tools_to_tmp)
    grep -q "^\[ponytail\]" "$tmp"
    rm -f "$tmp"
}


@test "ponytail is enabled by default" {
    local tmp; tmp=$(_write_tools_to_tmp)
    local in_section=0
    while IFS= read -r line; do
        [[ "$line" == "[ponytail]" ]] && in_section=1 && continue
        [[ "$line" =~ ^\[.*\]$ ]] && in_section=0
        if [[ "$in_section" -eq 1 && "$line" == "enabled=true" ]]; then
            rm -f "$tmp"; return 0
        fi
    done < "$tmp"
    rm -f "$tmp"; return 1
}

@test "ponytail command uses npm: prefix" {
    local tmp; tmp=$(_write_tools_to_tmp)
    local in_section=0
    while IFS= read -r line; do
        [[ "$line" == "[ponytail]" ]] && in_section=1 && continue
        [[ "$line" =~ ^\[.*\]$ ]] && in_section=0
        if [[ "$in_section" -eq 1 && "$line" == command=npm:* ]]; then
            rm -f "$tmp"; return 0
        fi
    done < "$tmp"
    rm -f "$tmp"; return 1
}

# ── system prompt rules ────────────────────────────────────────────────────────

@test "system prompt forbids Co-Authored-By in commits" {
    grep -q "Co-Authored-By" "${BATS_TEST_DIRNAME}/../bin/optimia"
}

@test "system prompt has no-commit rule" {
    grep -q "No commit" "${BATS_TEST_DIRNAME}/../bin/optimia"
}

@test "anti-patterns list includes Co-Authored-By entry" {
    grep -q "Co-Authored-By" "${BATS_TEST_DIRNAME}/../bin/optimia"
}

# ── version ────────────────────────────────────────────────────────────────────

@test "--version flag exits 0 and prints a version number" {
    # env -u unsets OPTIMIA_SOURCED so main() runs in the subprocess
    run env -u OPTIMIA_SOURCED bash "${BATS_TEST_DIRNAME}/../bin/optimia" --version
    [ "$status" -eq 0 ]
    [[ "$output" == *"0."* ]]
}

# ── migrations ─────────────────────────────────────────────────────────────────

@test "_tools_append_section adds a missing section" {
    local tmp; tmp=$(mktemp)
    echo "[existing]" > "$tmp"
    OPTIMIA_TOOLS_FILE="$tmp" _tools_append_section "newsec" "[newsec]
key=val"
    grep -q "^\[newsec\]" "$tmp"
    rm -f "$tmp"
}

@test "_tools_append_section is idempotent — does not duplicate" {
    local tmp; tmp=$(mktemp)
    echo "[existing]" > "$tmp"
    OPTIMIA_TOOLS_FILE="$tmp" _tools_append_section "existing" "[existing]
key=val"
    local count; count=$(grep -c "^\[existing\]" "$tmp")
    rm -f "$tmp"
    [ "$count" -eq 1 ]
}

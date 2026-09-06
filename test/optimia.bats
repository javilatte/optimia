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
    npm list -g --depth=0 headroom &>/dev/null \
        || skip "headroom is not globally installed on this machine"
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

@test "get_install_hint: openwiki returns npm install hint" {
    run get_install_hint openwiki
    [ "$status" -eq 0 ]
    [[ "$output" == *"npm install -g openwiki"* ]]
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

@test "default tools config includes [openwiki]" {
    local tmp; tmp=$(_write_tools_to_tmp)
    grep -q "^\[openwiki\]" "$tmp"
    rm -f "$tmp"
}

@test "openwiki is enabled by default" {
    local tmp; tmp=$(_write_tools_to_tmp)
    local in_section=0
    while IFS= read -r line; do
        [[ "$line" == "[openwiki]" ]] && in_section=1 && continue
        [[ "$line" =~ ^\[.*\]$ ]] && in_section=0
        if [[ "$in_section" -eq 1 && "$line" == "enabled=true" ]]; then
            rm -f "$tmp"; return 0
        fi
    done < "$tmp"
    rm -f "$tmp"; return 1
}

@test "ensure_project_dir: symlinks openwiki into .optimia when tool installed" {
    local repo fakebin
    repo=$(mktemp -d); fakebin=$(mktemp -d)
    printf '#!/bin/sh\nexit 0\n' > "$fakebin/openwiki"
    chmod +x "$fakebin/openwiki"

    local tools_conf="$repo/tools.conf"
    printf '[openwiki]\ncommand=openwiki\nenabled=true\n' > "$tools_conf"

    (
        cd "$repo"
        git init -q .
        PATH="$fakebin:$PATH" OPTIMIA_TOOLS_FILE="$tools_conf" ensure_project_dir
    )

    [ -L "$repo/openwiki" ]
    [ -d "$repo/.optimia/openwiki" ]
    grep -q '^/openwiki$' "$repo/.gitignore"
    rm -rf "$repo" "$fakebin"
}

@test "ensure_project_dir: leaves a real openwiki/ dir untouched" {
    local repo fakebin
    repo=$(mktemp -d); fakebin=$(mktemp -d)
    printf '#!/bin/sh\nexit 0\n' > "$fakebin/openwiki"
    chmod +x "$fakebin/openwiki"

    local tools_conf="$repo/tools.conf"
    printf '[openwiki]\ncommand=openwiki\nenabled=true\n' > "$tools_conf"

    (
        cd "$repo"
        git init -q .
        mkdir openwiki
        PATH="$fakebin:$PATH" OPTIMIA_TOOLS_FILE="$tools_conf" ensure_project_dir
    )

    [ -d "$repo/openwiki" ]
    [ ! -L "$repo/openwiki" ]
    [ ! -d "$repo/.optimia/openwiki" ]
    ! grep -q '^/openwiki$' "$repo/.gitignore"
    rm -rf "$repo" "$fakebin"
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

# ── self-update: version_gt ─────────────────────────────────────────────────────

@test "version_gt: 0.2.10 > 0.2.9 (catches naive string comparison)" {
    run version_gt "0.2.10" "0.2.9"
    [ "$status" -eq 0 ]
}

@test "version_gt: 0.2.9 is not > 0.2.10" {
    run version_gt "0.2.9" "0.2.10"
    [ "$status" -ne 0 ]
}

@test "version_gt: equal versions are not greater" {
    run version_gt "1.0.0" "1.0.0"
    [ "$status" -ne 0 ]
}

@test "version_gt: 0.3.0 > 0.2.9" {
    run version_gt "0.3.0" "0.2.9"
    [ "$status" -eq 0 ]
}

# ── self-update: check_for_updates ──────────────────────────────────────────────

_update_tmp_dir() {
    local dir; dir=$(mktemp -d)
    printf 'check_updates=true\n' > "$dir/config.conf"
    touch "$dir/update.conf"
    echo "$dir"
}

@test "check_for_updates: skips entirely when check_updates=false" {
    local dir; dir=$(_update_tmp_dir)
    printf 'check_updates=false\n' > "$dir/config.conf"
    local calllog="$dir/npm.log"
    npm() { echo "$*" >> "$calllog"; }

    OPTIMIA_GLOBAL_FILE="$dir/config.conf" OPTIMIA_UPDATE_FILE="$dir/update.conf" run check_for_updates
    [ "$status" -eq 0 ]
    [ ! -s "$calllog" ]
    rm -rf "$dir"
}

@test "check_for_updates: skips entirely when CI is set (no network calls)" {
    local dir; dir=$(_update_tmp_dir)
    local calllog="$dir/npm.log"
    npm() { echo "$*" >> "$calllog"; }

    CI=true OPTIMIA_GLOBAL_FILE="$dir/config.conf" OPTIMIA_UPDATE_FILE="$dir/update.conf" run check_for_updates
    [ "$status" -eq 0 ]
    [ ! -s "$calllog" ]
    rm -rf "$dir"
}

@test "check_for_updates: skips the registry lookup when not installed via npm -g" {
    local dir; dir=$(_update_tmp_dir)
    local calllog="$dir/npm.log"
    npm() {
        echo "$*" >> "$calllog"
        [[ "$1" == "ls" ]] && return 1
        return 0
    }

    OPTIMIA_GLOBAL_FILE="$dir/config.conf" OPTIMIA_UPDATE_FILE="$dir/update.conf" run check_for_updates
    [ "$status" -eq 0 ]
    ! grep -q '^view' "$calllog"
    rm -rf "$dir"
}

@test "check_for_updates: throttles — skips 'npm view' on a repeat call within the interval" {
    local dir; dir=$(_update_tmp_dir)
    printf 'check_updates=true\nupdate_check_interval_days=1\n' > "$dir/config.conf"
    local calllog="$dir/npm.log"
    npm() {
        echo "$*" >> "$calllog"
        case "$1" in
            ls) return 0 ;;
            view) echo "0.2.6" ;;
        esac
    }

    OPTIMIA_GLOBAL_FILE="$dir/config.conf" OPTIMIA_UPDATE_FILE="$dir/update.conf" run check_for_updates
    [ "$status" -eq 0 ]
    [ "$(grep -c '^view' "$calllog")" -eq 1 ]

    : > "$calllog"
    OPTIMIA_GLOBAL_FILE="$dir/config.conf" OPTIMIA_UPDATE_FILE="$dir/update.conf" run check_for_updates
    [ "$status" -eq 0 ]
    ! grep -q '^view' "$calllog"
    grep -q '^ls' "$calllog"
    rm -rf "$dir"
}

@test "check_for_updates: rejects corrupt npm view output (no false positive)" {
    local dir; dir=$(_update_tmp_dir)
    local calllog="$dir/npm.log"
    npm() {
        echo "$*" >> "$calllog"
        case "$1" in
            ls) return 0 ;;
            view) echo "npm WARN using --force Recommended protections disabled." ;;
        esac
    }

    OPTIMIA_GLOBAL_FILE="$dir/config.conf" OPTIMIA_UPDATE_FILE="$dir/update.conf" run check_for_updates
    [ "$status" -eq 0 ]
    [[ "$output" != *"$_MSG_UPDATE_AVAILABLE"* ]]
    local stored; stored=$(kv_get "$dir/update.conf" "latest_seen" "")
    [ -z "$stored" ]
    rm -rf "$dir"
}

@test "check_for_updates: offers the update and installs it on 'y'" {
    local dir; dir=$(_update_tmp_dir)
    local calllog="$dir/npm.log"
    npm() {
        echo "$*" >> "$calllog"
        case "$1" in
            ls) return 0 ;;
            view) echo "9.9.9" ;;
        esac
    }
    safe_install() { echo "safe_install:$*" >> "$calllog"; return 0; }
    _accept_update() { check_for_updates <<< "y"; }

    OPTIMIA_GLOBAL_FILE="$dir/config.conf" OPTIMIA_UPDATE_FILE="$dir/update.conf" run _accept_update
    [ "$status" -eq 0 ]
    [[ "$output" == *"$_MSG_UPDATE_AVAILABLE"* ]]
    grep -q "safe_install:npm install -g @javilatte/optimia" "$calllog"
    rm -rf "$dir"
}

@test "check_for_updates: declining the prompt does not install anything" {
    local dir; dir=$(_update_tmp_dir)
    local calllog="$dir/npm.log"
    npm() {
        echo "$*" >> "$calllog"
        case "$1" in
            ls) return 0 ;;
            view) echo "9.9.9" ;;
        esac
    }
    safe_install() { echo "safe_install:$*" >> "$calllog"; return 0; }
    _decline_update() { check_for_updates <<< "n"; }

    OPTIMIA_GLOBAL_FILE="$dir/config.conf" OPTIMIA_UPDATE_FILE="$dir/update.conf" run _decline_update
    [ "$status" -eq 0 ]
    ! grep -q "safe_install" "$calllog"
    rm -rf "$dir"
}

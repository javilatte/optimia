#!/usr/bin/env bats

# Integration tests: run the real `optimia tools list` command against a
# fresh temp config dir so we exercise ensure_config + write_default_tools
# + cmd_tools end-to-end.

setup() {
    export TMPDIR_CONFIG; TMPDIR_CONFIG=$(mktemp -d)
    # Redirect config to an isolated temp dir via XDG_CONFIG_HOME
    export XDG_CONFIG_HOME="$TMPDIR_CONFIG"
}

teardown() {
    rm -rf "$TMPDIR_CONFIG"
}

_tools_list() {
    env -u OPTIMIA_SOURCED XDG_CONFIG_HOME="$TMPDIR_CONFIG" \
        bash "${BATS_TEST_DIRNAME}/../bin/optimia" tools list 2>&1
}

# ── ponytail ───────────────────────────────────────────────────────────────────

@test "tools list: ponytail appears in output" {
    run _tools_list
    [ "$status" -eq 0 ]
    [[ "$output" == *"ponytail"* ]]
}

@test "tools list: ponytail shows [not installed] when npm package missing" {
    run _tools_list
    if npm list -g --depth=0 @dietrichgebert/ponytail &>/dev/null 2>&1; then
        skip "@dietrichgebert/ponytail is installed on this machine"
    fi
    echo "$output" | grep "ponytail" | grep -q "not installed"
}

# ── openwiki ───────────────────────────────────────────────────────────────────

@test "tools list: openwiki appears in output" {
    run _tools_list
    [ "$status" -eq 0 ]
    [[ "$output" == *"openwiki"* ]]
}

@test "migration: openwiki section is added to a pre-0.2.5 tools.conf" {
    mkdir -p "$TMPDIR_CONFIG/optimia"
    printf '[claude]\ncommand=claude\nenabled=true\nai_tool=true\n' \
        > "$TMPDIR_CONFIG/optimia/tools.conf"
    run _tools_list
    [ "$status" -eq 0 ]
    grep -q "^\[openwiki\]" "$TMPDIR_CONFIG/optimia/tools.conf"
}

# ── both tools in the same run ─────────────────────────────────────────────────

@test "tools list: contains all expected tools in one run" {
    run _tools_list
    [ "$status" -eq 0 ]
    [[ "$output" == *"claude"*      ]]
    [[ "$output" == *"headroom"*    ]]
    [[ "$output" == *"codegraph"*   ]]
    [[ "$output" == *"ponytail"*    ]]
    [[ "$output" == *"openwiki"*    ]]
}

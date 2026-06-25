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

# ── agent-reach ────────────────────────────────────────────────────────────────

@test "tools list: agent-reach appears in output" {
    run _tools_list
    [ "$status" -eq 0 ]
    [[ "$output" == *"agent-reach"* ]]
}

@test "tools list: agent-reach shows as disabled" {
    run _tools_list
    [[ "$output" == *"agent-reach"* ]]
    # disabled tools show ✗ — check the agent-reach line has no [AI] tag
    # and that the section exists; enabled=false means it won't show ✓
    echo "$output" | grep "agent-reach" | grep -qv "\[AI\]"
}

@test "tools list: agent-reach shows [not installed] when binary missing" {
    run _tools_list
    # agent-reach binary is not installed in CI — expect [not installed]
    if command -v agent-reach &>/dev/null; then
        skip "agent-reach is installed on this machine"
    fi
    echo "$output" | grep "agent-reach" | grep -q "not installed"
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

# ── both tools in the same run ─────────────────────────────────────────────────

@test "tools list: contains all expected tools in one run" {
    run _tools_list
    [ "$status" -eq 0 ]
    [[ "$output" == *"claude"*      ]]
    [[ "$output" == *"headroom"*    ]]
    [[ "$output" == *"codegraph"*   ]]
    [[ "$output" == *"agent-reach"* ]]
    [[ "$output" == *"ponytail"*    ]]
}

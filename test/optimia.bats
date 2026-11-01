#!/usr/bin/env bats

# bin/optimia is now a thin Node launcher (see Fase 10), not a bash script —
# these tests exercise it as a black box: CLI flags and the .optimia/
# project-dir setup it performs before handing off to the server.

OPTIMIA_BIN="${BATS_TEST_DIRNAME}/../bin/optimia"

setup() {
    TESTDIR=$(mktemp -d)
}

teardown() {
    rm -rf "$TESTDIR"
}

@test "optimia --version: prints a version string matching package.json" {
    run node "$OPTIMIA_BIN" --version
    [ "$status" -eq 0 ]
    expected=$(node -e "console.log(require('${BATS_TEST_DIRNAME}/../package.json').version)")
    [[ "$output" == "optimia $expected" ]]
}

@test "optimia --help: documents that config lives in the web UI, not the CLI" {
    run node "$OPTIMIA_BIN" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"interfaz web"* ]]
}

@test "optimia: in a git repo, creates .optimia/, symlinks .codegraph, and updates .gitignore" {
    cd "$TESTDIR"
    git init -q
    git config user.email test@test.com
    git config user.name test
    echo hola > README.md
    git add README.md
    git commit -q -m init

    # stdin redirected from /dev/null -> not a TTY -> codegraph prompt
    # auto-declines instead of hanging; server keeps running until killed.
    node "$OPTIMIA_BIN" < /dev/null > server.log 2>&1 &
    pid=$!
    for i in $(seq 1 50); do
        [ -d .optimia ] && break
        sleep 0.1
    done
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true

    [ -d .optimia ]
    [ -L .codegraph ]
    grep -q '^/.optimia$' .gitignore
    grep -q '^/.codegraph$' .gitignore
    grep -q "optimia running at" server.log
}

@test "optimia: outside a git repo, still creates .optimia/ but skips CodeGraph setup" {
    cd "$TESTDIR"

    node "$OPTIMIA_BIN" < /dev/null > server.log 2>&1 &
    pid=$!
    for i in $(seq 1 50); do
        [ -d .optimia ] && break
        sleep 0.1
    done
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true

    [ -d .optimia ]
    [ ! -e .codegraph ]
}

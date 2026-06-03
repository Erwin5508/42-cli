#!/usr/bin/env python3
"""Behavioural checker for the push_swap project (subject v1.1).

Node compiles the student's project; this harness runs the produced binary and
acts as the checker: it feeds inputs, reads the Push_swap operation stream from
stdout, replays it on a simulated pair of stacks, and verifies stack a ends up
sorted ascending with b empty. It also counts operations against the subject's
performance thresholds, exercises the strategy selectors, checks error handling
and the --bench output format.

  --bin    path to the compiled push_swap binary
  --color  colourise output

Exit codes: 0 all passed, 1 something failed, 2 the binary is missing/unusable.
Stdlib only, Python 3.8+.
"""

import argparse
import os
import random
import subprocess
import sys

VALID_OPS = {"sa", "sb", "ss", "pa", "pb", "ra", "rb", "rr", "rra", "rrb", "rrr"}

# performance thresholds from the subject (ops must be strictly under "pass")
THRESHOLDS = {
    100: {"pass": 2000, "good": 1500, "excellent": 700},
    500: {"pass": 12000, "good": 8000, "excellent": 5500},
}

USE_COLOR = False


def _c(code, s):
    return f"\033[{code}m{s}\033[0m" if USE_COLOR else s


def green(s): return _c("32", s)
def red(s): return _c("31", s)
def yellow(s): return _c("33", s)
def cyan(s): return _c("36", s)
def dim(s): return _c("2", s)
def bold(s): return _c("1", s)


# --------------------------------------------------------------------------
# stack simulator
# --------------------------------------------------------------------------

def apply_ops(a, b, ops):
    """Replay the operation list on stacks a/b (index 0 == top)."""
    for op in ops:
        if op == "sa":
            if len(a) >= 2:
                a[0], a[1] = a[1], a[0]
        elif op == "sb":
            if len(b) >= 2:
                b[0], b[1] = b[1], b[0]
        elif op == "ss":
            if len(a) >= 2:
                a[0], a[1] = a[1], a[0]
            if len(b) >= 2:
                b[0], b[1] = b[1], b[0]
        elif op == "pa":
            if b:
                a.insert(0, b.pop(0))
        elif op == "pb":
            if a:
                b.insert(0, a.pop(0))
        elif op == "ra":
            if a:
                a.append(a.pop(0))
        elif op == "rb":
            if b:
                b.append(b.pop(0))
        elif op == "rr":
            if a:
                a.append(a.pop(0))
            if b:
                b.append(b.pop(0))
        elif op == "rra":
            if a:
                a.insert(0, a.pop())
        elif op == "rrb":
            if b:
                b.insert(0, b.pop())
        elif op == "rrr":
            if a:
                a.insert(0, a.pop())
            if b:
                b.insert(0, b.pop())
        else:
            raise ValueError(op)


# --------------------------------------------------------------------------
# running the binary
# --------------------------------------------------------------------------

def run_bin(binary, numbers, flags=None, timeout=20):
    argv = [binary]
    if flags:
        argv += flags
    argv += [str(n) for n in numbers]
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, None, None, "timed out (looped forever or waited on input)"
    except Exception as exc:  # noqa: BLE001
        return None, None, None, f"failed to launch: {exc}"
    return proc.returncode, proc.stdout, proc.stderr, None


def parse_ops(stdout):
    """Split stdout into operations; return (ops, bad_token_or_None)."""
    ops = []
    for line in stdout.split("\n"):
        tok = line.strip()
        if tok == "":
            continue
        if tok not in VALID_OPS:
            return ops, tok
        ops.append(tok)
    return ops, None


def check_sort(binary, numbers, flags=None):
    """Run the binary on `numbers`, replay ops, verify sorted. Returns
    (ok, n_ops, detail)."""
    rc, out, err, launch_err = run_bin(binary, numbers, flags)
    if launch_err:
        return False, 0, launch_err
    ops, bad = parse_ops(out)
    if bad is not None:
        return False, len(ops), f"invalid operation on stdout: {bad!r}"
    a = list(numbers)
    b = []
    try:
        apply_ops(a, b, ops)
    except ValueError as exc:
        return False, len(ops), f"invalid operation {exc}"
    if b:
        return False, len(ops), f"stack b is not empty after sorting ({len(b)} left)"
    if a != sorted(numbers):
        return False, len(ops), "stack a is not sorted ascending after the operations"
    return True, len(ops), ""


# --------------------------------------------------------------------------
# test groups
# --------------------------------------------------------------------------

class Results:
    def __init__(self):
        self.passed = 0
        self.failed = 0

    def record(self, name, ok, detail=""):
        mark = green("  ✓") if ok else red("  ✗")
        print(f"  {mark} {name}")
        if not ok and detail:
            for line in str(detail).splitlines():
                print(dim(f"        {line}"))
        if ok:
            self.passed += 1
        else:
            self.failed += 1


def section(title):
    print()
    print(f"  {cyan(bold(title))}")


def test_errors(binary, r):
    section("error handling — must print \"Error\" to stderr, nothing to stdout")
    cases = [
        ("non-integer argument", ["0", "one", "2", "3"]),
        ("duplicate values", ["3", "2", "3"]),
        ("greater than INT_MAX", ["2147483648"]),
        ("less than INT_MIN", ["-2147483649"]),
        ("trailing junk", ["1", "2", "3x"]),
    ]
    for name, nums in cases:
        rc, out, err, launch_err = run_bin(binary, nums)
        if launch_err:
            r.record(name, False, launch_err)
            continue
        ok = (out.strip() == "") and (err.strip() == "Error")
        detail = ""
        if not ok:
            detail = (f"expected empty stdout + \"Error\" on stderr; "
                      f"got stdout={out.strip()[:40]!r} stderr={err.strip()[:40]!r}")
        r.record(name, ok, detail)


def test_no_args(binary, r):
    section("no arguments — must output nothing and exit cleanly")
    rc, out, err, launch_err = run_bin(binary, [])
    if launch_err:
        r.record("no arguments", False, launch_err)
        return
    ok = out.strip() == "" and err.strip() == ""
    r.record("no arguments", ok,
             "" if ok else f"expected no output; got stdout={out.strip()[:40]!r} stderr={err.strip()[:40]!r}")


def test_correctness(binary, r):
    section("sorting correctness")
    # already sorted / trivial sizes must use the minimal number of ops (0)
    ok, n, detail = check_sort(binary, [1, 2, 3, 4, 5])
    r.record("already sorted (5) -> 0 operations",
             ok and n == 0, detail or (f"sorted but used {n} ops (expected 0)" if ok else detail))
    ok, n, detail = check_sort(binary, [42])
    r.record("single element -> 0 operations",
             ok and n == 0, detail or (f"used {n} ops (expected 0)" if ok else detail))
    for nums in ([2, 1], [1, 3, 2], [3, 2, 1], [2, 3, 1]):
        ok, n, detail = check_sort(binary, nums)
        r.record(f"sorts {nums} ({n} ops)", ok, detail)
    # random small + medium
    for seed in (1, 2, 3):
        random.seed(seed)
        nums = random.sample(range(-50000, 50000), 5)
        ok, n, detail = check_sort(binary, nums)
        r.record(f"sorts random 5 (seed {seed}, {n} ops)", ok, detail)
    for seed in (10, 20):
        random.seed(seed)
        nums = random.sample(range(-50000, 50000), 100)
        ok, n, detail = check_sort(binary, nums)
        r.record(f"sorts random 100 (seed {seed}, {n} ops)", ok, detail)


def _tier(n, size):
    t = THRESHOLDS[size]
    if n < t["excellent"]:
        return green("excellent")
    if n < t["good"]:
        return green("good")
    if n < t["pass"]:
        return yellow("pass")
    return red("OVER LIMIT")


def test_performance(binary, r, size, trials, seeds):
    section(f"performance — {size} numbers (must be < {THRESHOLDS[size]['pass']} ops)")
    worst = -1
    all_ok = True
    for seed in seeds[:trials]:
        random.seed(seed)
        nums = random.sample(range(-100000, 100000), size)
        ok, n, detail = check_sort(binary, nums)
        if not ok:
            all_ok = False
            r.record(f"{size} numbers (seed {seed}) — not sorted", False, detail)
            continue
        worst = max(worst, n)
        within = n < THRESHOLDS[size]["pass"]
        all_ok = all_ok and within
        r.record(f"{size} numbers (seed {seed}): {n} ops — {_tier(n, size)}", within,
                 "" if within else f"{n} ops >= {THRESHOLDS[size]['pass']} (over the pass limit)")
    if worst >= 0:
        print(dim(f"      worst case: {worst} ops  ·  pass<{THRESHOLDS[size]['pass']}  "
                  f"good<{THRESHOLDS[size]['good']}  excellent<{THRESHOLDS[size]['excellent']}"))
    return all_ok


def test_selectors(binary, r):
    section("strategy selectors — each must sort correctly")
    random.seed(99)
    nums = random.sample(range(-100000, 100000), 100)
    for flag in ("--simple", "--medium", "--complex", "--adaptive"):
        ok, n, detail = check_sort(binary, nums, flags=[flag])
        r.record(f"{flag} sorts 100 ({n} ops)", ok, detail)
    ok, n, detail = check_sort(binary, [5, 4, 3, 2, 1], flags=["--simple"])
    r.record(f"--simple sorts 5 4 3 2 1 ({n} ops)", ok, detail)


def test_bench(binary, r):
    section("--bench mode — metrics on stderr, operations still on stdout")
    random.seed(7)
    nums = random.sample(range(-100000, 100000), 20)
    rc, out, err, launch_err = run_bin(binary, nums, flags=["--bench"])
    if launch_err:
        r.record("--bench runs", False, launch_err)
        return
    # operation stream must still be valid + sort on stdout
    ops, bad = parse_ops(out)
    sort_ok = bad is None
    if sort_ok:
        a, b = list(nums), []
        try:
            apply_ops(a, b, ops)
            sort_ok = (a == sorted(nums) and not b)
        except ValueError:
            sort_ok = False
    r.record("operations stream stays on stdout and sorts", sort_ok,
             "" if sort_ok else "stdout did not contain a valid sorting operation stream")

    low = err.lower()
    has_bench = "[bench]" in low
    has_fields = all(k in low for k in ("disorder", "strategy", "total_ops"))
    r.record("[bench] block present on stderr with disorder/strategy/total_ops",
             has_bench and has_fields,
             "" if (has_bench and has_fields) else f"stderr did not contain the expected [bench] fields:\n{err.strip()[:200]}")

    # total_ops should match the number of operations on stdout
    total = None
    for line in err.splitlines():
        if "total_ops" in line.lower():
            for tok in line.replace(":", " ").split():
                if tok.isdigit():
                    total = int(tok)
                    break
    if total is not None:
        r.record(f"total_ops ({total}) matches stdout operation count ({len(ops)})",
                 total == len(ops),
                 "" if total == len(ops) else "the reported total_ops disagrees with the stream length")


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def main():
    global USE_COLOR
    parser = argparse.ArgumentParser()
    parser.add_argument("--bin", required=True)
    parser.add_argument("--color", action="store_true")
    args = parser.parse_args()
    USE_COLOR = args.color

    binary = os.path.abspath(args.bin)
    if not os.path.exists(binary) or not os.access(binary, os.X_OK):
        print(red(f"  push_swap binary not found or not executable: {binary}"))
        return 2

    r = Results()
    test_errors(binary, r)
    test_no_args(binary, r)
    test_correctness(binary, r)
    test_selectors(binary, r)
    test_performance(binary, r, 100, trials=3, seeds=[101, 202, 303])
    test_performance(binary, r, 500, trials=2, seeds=[501, 601])
    test_bench(binary, r)

    print()
    print(f"  {bold('Result:')} {green(str(r.passed) + ' passed')}, "
          f"{red(str(r.failed) + ' failed')}")
    print()
    return 0 if r.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Generic grader for a single Exam Practice exercise.

The piscine tester (resources/py-tester/run_tests.py) grades a whole project
against a behavioural spec. This harness does the same job for one standalone
exam exercise, in either language:

  * lang == "c"      compile the student's source(s) with cc -Wall -Wextra
                     -Werror into a throwaway binary, then run it per test.
  * lang == "python" run `python3 <solution_file>` per test.

Each test feeds argv + stdin and checks exit code / stdout / stderr against the
behaviour the subject pins down. Driven by one exercise JSON spec:

  --spec  path to the exercise spec (resources/exam/<bank>/<id>.json)
  --dir   the folder the student solved the exercise in (holds solution_file)

Exit codes mirror the project tester: 0 all passed, 1 something failed (or a
build error), 2 the solution file is missing, 3 the environment is unusable
(no C compiler).

Stdlib only, Python 3.8+.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

# --------------------------------------------------------------------------
# colours
# --------------------------------------------------------------------------

USE_COLOR = False


def _c(code, s):
    return f"\033[{code}m{s}\033[0m" if USE_COLOR else s


def green(s):
    return _c("32", s)


def red(s):
    return _c("31", s)


def yellow(s):
    return _c("33", s)


def cyan(s):
    return _c("36", s)


def dim(s):
    return _c("2", s)


def bold(s):
    return _c("1", s)


# --------------------------------------------------------------------------
# normalisation + matching
# (kept in sync with resources/py-tester/run_tests.py — same semantics)
# --------------------------------------------------------------------------

def normalize(text):
    if text is None:
        text = ""
    text = (text
            .replace("’", "'").replace("‘", "'")
            .replace("“", '"').replace("”", '"')
            .replace("–", "-").replace("—", "-"))
    lines = [ln.rstrip() for ln in text.splitlines()]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


def _diff(expected, actual):
    exp = expected.splitlines()
    act = actual.splitlines()
    out = ["expected:"]
    out += ["    " + ln for ln in exp[:12]]
    out.append("got:")
    out += ["    " + ln for ln in act[:12]]
    return "\n      ".join(out)


def check_rule(rule, actual):
    if rule is None:
        return True, ""
    norm = normalize(actual)
    rtype = rule.get("type", "contains_all")

    if rtype == "equals":
        expected = normalize(rule["expected"])
        if norm == expected:
            return True, ""
        return False, _diff(expected, norm)

    if rtype == "contains_all":
        missing = [item for item in rule["items"] if normalize(item) not in norm]
        if missing:
            return False, "missing: " + ", ".join(repr(m) for m in missing)
        return True, ""

    if rtype == "in_order":
        pos = 0
        for item in rule["items"]:
            needle = normalize(item)
            idx = norm.find(needle, pos)
            if idx < 0:
                return False, f"not found in order: {item!r}"
            pos = idx + len(needle)
        return True, ""

    if rtype == "regex":
        import re
        if re.search(rule["pattern"], norm, re.MULTILINE | re.DOTALL):
            return True, ""
        return False, f"no match for /{rule['pattern']}/"

    if rtype == "not_empty":
        if norm.strip():
            return True, ""
        return False, "output was empty"

    return False, f"unknown match type {rtype!r}"


# --------------------------------------------------------------------------
# running a single test against a command
# --------------------------------------------------------------------------

def run_one(cmd, cwd, test):
    argv = test.get("argv", [])
    stdin_data = test.get("stdin", "")
    timeout = test.get("timeout", 15)
    try:
        proc = subprocess.run(
            [*cmd, *argv],
            cwd=cwd,
            input=stdin_data,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return False, (f"timed out after {timeout}s — the program likely "
                       "looped forever or waited on input")
    except Exception as exc:  # noqa: BLE001
        return False, f"failed to launch: {exc}"

    match = test.get("match", {})
    details = []
    if "exit_code" in match and proc.returncode != match["exit_code"]:
        details.append(f"exit code: expected {match['exit_code']}, got {proc.returncode}")
    if "stdout" in match:
        ok, detail = check_rule(match["stdout"], proc.stdout)
        if not ok:
            details.append("stdout — " + detail)
    if "stderr" in match:
        ok, detail = check_rule(match["stderr"], proc.stderr)
        if not ok:
            details.append("stderr — " + detail)
    if details:
        return False, "\n      ".join(details)
    return True, ""


# --------------------------------------------------------------------------
# compilation (C)
# --------------------------------------------------------------------------

def compile_c(spec, project_dir, out_path):
    """Compile the exercise's C sources into out_path. Returns (ok, message)."""
    if shutil.which("cc") is None and shutil.which("gcc") is None:
        return None, "no C compiler found (install cc / gcc)"
    compiler = "cc" if shutil.which("cc") else "gcc"

    comp = spec.get("compile", {})
    flags = comp.get("flags", ["-Wall", "-Wextra", "-Werror"])
    sources = [spec["solution_file"], *comp.get("extra_files", [])]
    missing = [s for s in sources if not os.path.exists(os.path.join(project_dir, s))]
    if missing:
        return False, "missing source file(s): " + ", ".join(missing)

    cmd = [compiler, *flags, *sources, "-o", out_path]
    try:
        proc = subprocess.run(cmd, cwd=project_dir, capture_output=True,
                              text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return False, "compilation timed out"
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip().splitlines()
        return False, "\n      ".join(err[-12:]) or "compilation failed"
    return True, ""


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def main():
    global USE_COLOR
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True)
    parser.add_argument("--dir", required=True)
    parser.add_argument("--color", action="store_true")
    args = parser.parse_args()
    USE_COLOR = args.color

    with open(args.spec) as fh:
        spec = json.load(fh)

    project_dir = os.path.abspath(args.dir)
    lang = spec.get("lang", "c")
    solution_file = os.path.basename(spec["solution_file"])
    sol_path = os.path.join(project_dir, solution_file)

    title = f"{spec.get('id', '?')} · {spec.get('title', '')}"
    print()
    print(f"  {cyan(bold(title))}  {dim('· difficulty ' + str(spec.get('difficulty', '?')) + '/4')}")
    print()

    if not os.path.exists(sol_path):
        print(f"  {yellow('Nothing to grade')} {dim('— ' + solution_file + ' was not found here.')}")
        print(f"  {dim('create ' + solution_file + ' in ' + project_dir + ' and grade again.')}")
        print()
        return 2

    tmp = None
    run_cmd = None
    cwd = project_dir
    try:
        if lang == "c":
            tmp = tempfile.mkdtemp(prefix="42exam_")
            out_path = os.path.join(tmp, "exam_bin")
            ok, msg = compile_c(spec, project_dir, out_path)
            if ok is None:
                print(f"  {red('✗ ' + msg)}")
                print()
                return 3
            if not ok:
                print(f"  {red('BUILD ERROR')}")
                for line in msg.splitlines():
                    print(dim(f"      {line}"))
                print()
                print("  " + f"{bold('Result:')} {red('build failed')}")
                print()
                return 1
            run_cmd = [out_path]
        elif lang == "python":
            run_cmd = [sys.executable, solution_file]
        else:
            print(f"  {red('unknown exercise language ' + repr(lang))}")
            return 3

        tests = spec.get("tests", [])
        n_pass = n_fail = 0
        for test in tests:
            try:
                ok, detail = run_one(run_cmd, cwd, test)
            except Exception as exc:  # noqa: BLE001
                ok, detail = False, f"grader error: {exc.__class__.__name__}: {exc}"
            mark = green("  ✓") if ok else red("  ✗")
            print(f"  {mark} {test.get('name', 'test')}")
            if not ok and detail:
                for line in detail.splitlines():
                    print(dim(f"        {line}"))
            if ok:
                n_pass += 1
            else:
                n_fail += 1

        print()
        head = green("PASS") if n_fail == 0 else red("FAIL")
        print(f"  {bold('Result:')} {head} "
              f"{dim(f'({n_pass}/{n_pass + n_fail} tests)')}")
        print()
        return 0 if n_fail == 0 else 1
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())

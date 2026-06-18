import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import textwrap

_MAX_ERROR_BYTES = 4096
_CASES_MARKER = "__CASES__"

# Prelude injected before solution code: best-effort network block.
# Stops ordinary Python socket use; not OS-level isolation (no seccomp/container).
_NETWORK_BLOCK = textwrap.dedent("""\
    import socket as _socket
    _orig_socket = _socket.socket
    def _no_network(*a, **kw):
        raise OSError("network access disabled in sandbox")
    _socket.socket = _no_network
""")


def _exec_argv(argv: list[str], cwd: str, timeout: int) -> dict:
    """Run python `argv` in an isolated subprocess (-I, own process group, SIGKILL on timeout) inside
    cwd. Returns {returncode, stdout (str), stderr (bytes), timed_out}."""
    try:
        proc = subprocess.Popen(
            [sys.executable, "-I", *argv],
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        stdout_bytes, stderr_bytes = proc.communicate(timeout=timeout)
        return {
            "returncode": proc.returncode,
            "stdout": stdout_bytes.decode("utf-8", errors="replace"),
            "stderr": stderr_bytes,
            "timed_out": False,
        }
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
        return {"returncode": -1, "stdout": "", "stderr": b"", "timed_out": True}


def _exec_runner(runner: str, timeout: int) -> dict:
    """Write a single runner script to a temp dir and run it isolated. Returns the _exec_argv result."""
    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "solution.py"), "w") as f:
            f.write(runner)
        return _exec_argv(["solution.py"], tmpdir, timeout)


def _stderr_text(stderr_bytes: bytes) -> str:
    error = stderr_bytes.decode("utf-8", errors="replace").strip()
    if len(error) > _MAX_ERROR_BYTES:
        error = error[:_MAX_ERROR_BYTES] + "\n...[truncated]"
    return error


def run_tests(
    solution_code: str,
    test_code: str,
    entry_point: str,
    timeout: int = 10,
) -> dict:
    """Run solution_code + test_code in an isolated subprocess.

    Returns {"passed": bool, "error": str | None, "timed_out": bool}.
    """
    # Trailing dispatcher: resolve the function under test, then call the test's check() on it.
    # Same harness for the Tester's check (in-loop) and the official check (scoring); only the
    # check() body differs. Candidate resolution: entry_point name first, else the single
    # top-level function defined in the solution, else a clear error.
    dispatch = textwrap.dedent(f"""\
        _ep = {entry_point!r}
        _cand = globals().get(_ep)
        if not callable(_cand):
            _defined = [
                _v for _k, _v in list(globals().items())
                if callable(_v) and getattr(_v, "__module__", None) == "__main__"
                and _k != "check" and not _k.startswith("_")
            ]
            if len(_defined) == 1:
                _cand = _defined[0]
            else:
                raise RuntimeError(
                    "cannot resolve candidate: entry_point " + repr(_ep)
                    + " not defined and " + str(len(_defined)) + " top-level functions found"
                )
        if not callable(globals().get("check")):
            raise RuntimeError("no check(candidate) function defined in tests")
        check(_cand)
    """)
    runner = "\n".join([_NETWORK_BLOCK, solution_code, test_code, dispatch])
    res = _exec_runner(runner, timeout)
    if res["timed_out"]:
        return {"passed": False, "error": "execution timed out", "timed_out": True}
    if res["returncode"] == 0:
        return {"passed": True, "error": None, "timed_out": False}
    return {"passed": False, "error": _stderr_text(res["stderr"]) or "(no stderr)", "timed_out": False}


# Detailed dispatcher: re-run the Tester's check() statement by statement so each assert becomes a
# reportable case. Reads _TEST_SRC and _EP injected just above it. Non-assert statements run too (so
# setup vars exist) but only asserts are recorded; execution stops at the first failure, matching
# assert semantics. Emits one __CASES__ JSON line on stdout. Falls back to a plain check(candidate)
# call when the check body cannot be parsed.
_DETAILED_DISPATCH = textwrap.dedent("""\
    import ast as _ast, json as _json, sys as _sys, traceback as _tb

    def _emit(_obj):
        _sys.stdout.write("__CASES__" + _json.dumps(_obj) + "\\n")
        _sys.stdout.flush()

    _cand = globals().get(_EP)
    if not callable(_cand):
        _defined = [
            _v for _k, _v in list(globals().items())
            if callable(_v) and getattr(_v, "__module__", None) == "__main__"
            and _k != "check" and not _k.startswith("_")
        ]
        _cand = _defined[0] if len(_defined) == 1 else None

    if _cand is None:
        _emit({"ok": False, "cases": [], "error": "cannot resolve candidate"})
        raise SystemExit(1)

    try:
        _tree = _ast.parse(_TEST_SRC)
        _check = next((_n for _n in _tree.body if isinstance(_n, _ast.FunctionDef) and _n.name == "check"), None)
    except Exception:
        _check = None

    if _check is None:
        try:
            check(_cand)
            _emit({"ok": True, "cases": []})
            raise SystemExit(0)
        except SystemExit:
            raise
        except Exception:
            _emit({"ok": False, "cases": [], "error": _tb.format_exc().splitlines()[-1][:200]})
            raise SystemExit(1)

    _param = _check.args.args[0].arg if _check.args.args else "candidate"
    _ns = dict(globals())
    _ns[_param] = _cand
    _cases = []
    _ok = True
    for _stmt in _check.body:
        _seg = (_ast.get_source_segment(_TEST_SRC, _stmt) or "").strip()
        _is_assert = isinstance(_stmt, _ast.Assert)
        try:
            exec(compile(_ast.Module(body=[_stmt], type_ignores=[]), "<check>", "exec"), _ns)
            if _is_assert:
                _cases.append({"name": _seg[:160], "passed": True, "error": None})
        except Exception:
            _ok = False
            _msg = _tb.format_exc().splitlines()[-1][:200]
            _cases.append({"name": _seg[:160] or "statement", "passed": False, "error": _msg})
            break
    _emit({"ok": _ok, "cases": _cases})
    raise SystemExit(0 if _ok else 1)
""")


def run_tests_detailed(
    solution_code: str,
    test_code: str,
    entry_point: str,
    timeout: int = 10,
) -> dict:
    """Like run_tests but also returns per-assertion cases when the check is a flat assert sequence.

    Return shape is a superset of run_tests: {passed, error, timed_out, cases}, where cases is
    [{name, passed, error}] (empty when the check is not decomposable). Used for the demo's test
    panel; the held-out official scoring still goes through run_tests / the scorer.
    """
    header = f"_TEST_SRC = {test_code!r}\n_EP = {entry_point!r}\n"
    runner = "\n".join([_NETWORK_BLOCK, solution_code, test_code, header, _DETAILED_DISPATCH])
    res = _exec_runner(runner, timeout)
    if res["timed_out"]:
        return {"passed": False, "error": "execution timed out", "timed_out": True, "cases": []}

    parsed = None
    for line in res["stdout"].splitlines():
        if line.startswith(_CASES_MARKER):
            try:
                parsed = json.loads(line[len(_CASES_MARKER):])
            except json.JSONDecodeError:
                parsed = None
            break

    if parsed is not None:
        cases = parsed.get("cases", []) or []
        if parsed.get("ok"):
            return {"passed": True, "error": None, "timed_out": False, "cases": cases}
        first_fail = next((c for c in cases if not c.get("passed")), None)
        error = (first_fail or {}).get("error") or parsed.get("error") or _stderr_text(res["stderr"]) or "(test failed)"
        return {"passed": False, "error": error, "timed_out": False, "cases": cases}

    # No structured output (crashed before emit): fall back to returncode + stderr.
    if res["returncode"] == 0:
        return {"passed": True, "error": None, "timed_out": False, "cases": []}
    return {"passed": False, "error": _stderr_text(res["stderr"]) or "(no stderr)", "timed_out": False, "cases": []}


# ---- Multi-file build projects (build mode) ----------------------------------------------------
# A build run produces several files, not one function. The Repairer runs them here in the same
# isolated-subprocess sandbox: write the manifest into a temp dir (never the real FS) and either run
# the project's test files (python) or sanity-check the entry (static). Return shape is the run_tests
# superset {passed, error, timed_out, cases, n_total, n_fail}, so the event stream, the room reducer
# and the test panel are reused unchanged.

_FILE_HDR = re.compile(r"^[ \t]*===[ \t]*FILE:[ \t]*(.+?)[ \t]*===[ \t]*$", re.MULTILINE)
_BLOCK = re.compile(r"```[A-Za-z0-9_+-]*\s*\n(.*?)```", re.DOTALL)


def _safe_rel_path(path: str) -> bool:
    """True when path is a safe relative project path (no traversal, no absolute, no drive)."""
    if not path or path.strip() != path:
        return False
    if path.startswith("/") or path.startswith("\\") or ":" in path:
        return False
    parts = path.replace("\\", "/").split("/")
    return all(p not in ("", ".", "..") for p in parts)


def parse_manifest(text: str) -> dict:
    """Parse a `=== FILE: <path> ===` + fenced-block manifest into {type, files:[{path, content}]}.

    Shared by the Repairer's run_project tool (its tool argument) and the conductor's FINAL_PROJECT
    terminal. `type` comes from an optional `type: python|static` line; unsafe paths are dropped.
    """
    ptype = None
    mt = re.search(r"^[ \t]*type:[ \t]*([A-Za-z_]+)", text, re.MULTILINE)
    if mt:
        ptype = mt.group(1).strip().lower()
    files: list[dict] = []
    headers = list(_FILE_HDR.finditer(text))
    for i, h in enumerate(headers):
        path = h.group(1).strip()
        start = h.end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        chunk = text[start:end]
        blk = _BLOCK.search(chunk)
        content = blk.group(1) if blk else chunk.strip("\n")
        if _safe_rel_path(path):
            files.append({"path": path, "content": content})
    return {"type": ptype, "files": files}


def _is_test_file(path: str) -> bool:
    base = path.rsplit("/", 1)[-1]
    return base.startswith("test_") and base.endswith(".py") or base.endswith("_test.py")


# Put the project dir on sys.path so test files can import the project modules. Needed because the
# sandbox runs with -I (isolated), which implies -P: the script's directory is NOT auto-prepended.
_PROJECT_PATH_SETUP = textwrap.dedent("""\
    import sys as _psys, os as _pos
    _psys.path.insert(0, _pos.path.dirname(_pos.path.abspath(__file__)))
""")

# Runner that executes each test file as __main__ (network blocked) and reports one case per file.
_PROJECT_TEST_DISPATCH = textwrap.dedent("""\
    import runpy as _rp, json as _json, sys as _sys, traceback as _tb
    _targets = _json.loads({targets!r})
    _cases, _ok = [], True
    for _t in _targets:
        try:
            _rp.run_path(_t, run_name="__main__")
            _cases.append({{"name": _t, "passed": True, "error": None}})
        except SystemExit as _e:
            if _e.code in (0, None):
                _cases.append({{"name": _t, "passed": True, "error": None}})
            else:
                _ok = False
                _cases.append({{"name": _t, "passed": False, "error": "exited with code " + str(_e.code)}})
        except Exception:
            _ok = False
            _cases.append({{"name": _t, "passed": False, "error": _tb.format_exc().splitlines()[-1][:200]}})
    _sys.stdout.write("__CASES__" + _json.dumps({{"ok": _ok, "cases": _cases}}) + "\\n")
""")

# Runner that byte-compiles every .py file when the project ships no tests (a syntax gate at least).
_PROJECT_COMPILE_DISPATCH = textwrap.dedent("""\
    import py_compile as _pc, json as _json, sys as _sys
    _targets = _json.loads({targets!r})
    _cases, _ok = [], True
    for _t in _targets:
        try:
            _pc.compile(_t, doraise=True)
            _cases.append({{"name": "compile " + _t, "passed": True, "error": None}})
        except Exception as _e:
            _ok = False
            _msg = (str(_e).splitlines() or ["compile error"])[0][:200]
            _cases.append({{"name": "compile " + _t, "passed": False, "error": _msg}})
    _sys.stdout.write("__CASES__" + _json.dumps({{"ok": _ok, "cases": _cases}}) + "\\n")
""")


def _result(passed: bool, error: str | None, cases: list, timed_out: bool = False) -> dict:
    n_fail = sum(1 for c in cases if not c.get("passed"))
    return {
        "passed": passed, "error": error, "timed_out": timed_out,
        "cases": cases, "n_total": len(cases), "n_fail": n_fail,
    }


def _parse_cases(stdout: str) -> dict | None:
    for line in stdout.splitlines():
        if line.startswith(_CASES_MARKER):
            try:
                return json.loads(line[len(_CASES_MARKER):])
            except json.JSONDecodeError:
                return None
    return None


def _run_python_project(tmpdir: str, files: list[dict], timeout: int) -> dict:
    test_files = sorted(f["path"] for f in files if _is_test_file(f["path"]))
    py_files = sorted(f["path"] for f in files if f["path"].endswith(".py"))
    prefix = _NETWORK_BLOCK + "\n" + _PROJECT_PATH_SETUP + "\n"
    if test_files:
        runner = prefix + _PROJECT_TEST_DISPATCH.format(targets=json.dumps(test_files))
    elif py_files:
        runner = prefix + _PROJECT_COMPILE_DISPATCH.format(targets=json.dumps(py_files))
    else:
        return _result(False, "no python files in project", [])
    with open(os.path.join(tmpdir, "_quartet_runner.py"), "w") as f:
        f.write(runner)
    res = _exec_argv(["_quartet_runner.py"], tmpdir, timeout)
    if res["timed_out"]:
        return _result(False, "execution timed out", [], timed_out=True)
    parsed = _parse_cases(res["stdout"])
    if parsed is not None:
        cases = parsed.get("cases", []) or []
        if parsed.get("ok"):
            return _result(True, None, cases)
        first = next((c for c in cases if not c.get("passed")), None)
        return _result(False, (first or {}).get("error") or "tests failed", cases)
    return _result(res["returncode"] == 0, _stderr_text(res["stderr"]) or "(no output)", [], )


def _check_static(files: list[dict]) -> dict:
    names = [f["path"] for f in files]
    has_index = any(n == "index.html" or n.endswith("/index.html") for n in names)
    empty = [f["path"] for f in files if not f["content"].strip()]
    cases = [{"name": "index.html present", "passed": has_index, "error": None if has_index else "no index.html at the project root"}]
    cases.append(
        {"name": "all files non-empty", "passed": not empty, "error": None if not empty else "empty: " + ", ".join(empty)}
    )
    ok = has_index and not empty
    return _result(ok, None if ok else "static project incomplete", cases)


def run_project(files: list[dict], project_type: str = "python", timeout: int = 20) -> dict:
    """Build/test a multi-file project in the isolated sandbox.

    files: [{path, content}] (relative paths only). project_type: "python" runs the test_*.py files
    (or byte-compiles when there are none); "static" sanity-checks the entry. Returns the run_tests
    superset {passed, error, timed_out, cases, n_total, n_fail}.
    """
    safe = [f for f in files if _safe_rel_path(f.get("path", "")) and isinstance(f.get("content"), str)]
    if not safe:
        return _result(False, "no valid files in the project manifest", [])
    with tempfile.TemporaryDirectory() as tmpdir:
        for f in safe:
            dest = os.path.join(tmpdir, f["path"])
            os.makedirs(os.path.dirname(dest) or tmpdir, exist_ok=True)
            with open(dest, "w", encoding="utf-8") as fh:
                fh.write(f["content"])
        if project_type == "static":
            return _check_static(safe)
        return _run_python_project(tmpdir, safe, timeout)


if __name__ == "__main__":
    from bench.dataset import get_problems

    problems = get_problems(n=30)[:3]
    all_passed = True

    for p in problems:
        solution = p["prompt"] + p["canonical_solution"]
        result = run_tests(solution, p["test"], p["entry_point"])

        status = "PASS" if result["passed"] else ("TIMEOUT" if result["timed_out"] else "FAIL")
        error_preview = ""
        if result["error"]:
            first_line = result["error"].splitlines()[0][:120]
            error_preview = f"  error: {first_line}"

        print(f"{status}  {p['task_id']}  entry={p['entry_point']}{error_preview}")

        if not result["passed"]:
            all_passed = False

    if not all_passed:
        sys.exit(1)

    print("\nAll 3 canonical solutions passed.")

import json
import os
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


def _exec_runner(runner: str, timeout: int) -> dict:
    """Run a runner script in an isolated subprocess (-I, own process group, SIGKILL on timeout).

    Returns {returncode, stdout (str), stderr (bytes), timed_out}.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        script = os.path.join(tmpdir, "solution.py")
        with open(script, "w") as f:
            f.write(runner)
        try:
            proc = subprocess.Popen(
                [sys.executable, "-I", "solution.py"],
                cwd=tmpdir,
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

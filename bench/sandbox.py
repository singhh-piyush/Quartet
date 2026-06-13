import os
import signal
import subprocess
import sys
import tempfile
import textwrap

_MAX_ERROR_BYTES = 4096

# Prelude injected before solution code: best-effort network block.
# Stops ordinary Python socket use; not OS-level isolation (no seccomp/container).
_NETWORK_BLOCK = textwrap.dedent("""\
    import socket as _socket
    _orig_socket = _socket.socket
    def _no_network(*a, **kw):
        raise OSError("network access disabled in sandbox")
    _socket.socket = _no_network
""")


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
            _, stderr_bytes = proc.communicate(timeout=timeout)
            timed_out = False
            returncode = proc.returncode
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()
            return {"passed": False, "error": "execution timed out", "timed_out": True}

    passed = returncode == 0
    if passed:
        return {"passed": True, "error": None, "timed_out": False}

    error = stderr_bytes.decode("utf-8", errors="replace").strip()
    if len(error) > _MAX_ERROR_BYTES:
        error = error[:_MAX_ERROR_BYTES] + "\n...[truncated]"
    return {"passed": False, "error": error or "(no stderr)", "timed_out": False}


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

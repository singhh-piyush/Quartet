import os
import time
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Set keys
os.environ["LLM_PROVIDER"] = "local"
os.environ["LARGE_PROVIDER"] = "local"
os.environ["QUARTET_MODE"] = "build"

from orchestrator.runner import RunManager
from orchestrator import run_config

# Mock apply_build_defaults so it doesn't switch to groq
run_config.apply_build_defaults = lambda cfg: cfg
run_config.load = lambda: run_config.defaults()

RUNS = RunManager()
res = RUNS.start_build("a site about cute frogs", "static", run_id="test_run_124")
print("Started run:", res)

while True:
    status = RUNS.status()
    if status["status"] in ("done", "error"):
        print("Finished:", status)
        break
    time.sleep(5)

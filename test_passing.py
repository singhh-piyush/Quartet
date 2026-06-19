import json
import os
from orchestrator import conductor
from bench import sandbox

run_id = "20260619T082945-be006fab"
print("_passing_manifest output:", conductor._passing_manifest(run_id))

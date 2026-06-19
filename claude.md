# Architecture Updates

## Fix for Repairer "Drifting"
The Repairer agent uses a small model (Qwen-2.5-Coder-7B) to test the `FINAL_PROJECT` files using the `run_project` tool.
Previously, the agent was instructed to pass the entire project manifest (200+ lines of HTML/CSS) into the `run_project` tool's JSON payload. This caused the 7B model to struggle, resulting in it truncating the manifest to tiny placeholder files just to satisfy the tool. The sandbox validated these placeholders as successful, but when it came time to output the final answer, the Repairer model hallucinated a default "Personal Portfolio" site from its training data.

### Solution Implemented
1. **Tool Signature Change**: `run_project(project_type)` no longer takes `manifest` as an argument.
2. **Automatic Extraction**: The `run_project` tool now automatically parses `results/transcripts/<run_id>.messages.jsonl` to extract the latest project files sent by the Coder/Tester.
3. **Prompt Update**: `prompts/build/repairer.md` was updated to instruct the agent to simply call `run_project(project_type=...)` without passing the files.

This ensures the sandbox perfectly tests the actual Coder files without the Repairer agent needing to regenerate or copy-paste them in tool calls, eliminating the hallucination vector.

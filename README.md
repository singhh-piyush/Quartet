# Quartet

Four small open-source models that work together to write code and prove it passes tests.

## The idea

One big model is expensive. Quartet shows that four small models, talking to each other through [Band](https://band.ai), can match a single large model on coding tasks at a fraction of the cost, and beat a single small model on its own.

## The four agents

Each agent is its own process running a small model. They coordinate through a Band chat room.

- **Spec** restates the problem and lists edge cases.
- **Coder** writes the code from the spec.
- **Tester** writes test cases, including tricky ones.
- **Repairer** runs the code in a sandbox, reads the failures, and sends fixes back to Coder.

The loop is Spec to Coder to Tester to Repairer. If tests pass, accept. If not, go back to Coder. It caps at 3 to 4 rounds.

## Two products on the same machinery

- **Race**: run the quartet over a HumanEval benchmark and race it against one large model. Score is Pass@1.
- **Build**: describe a small project in plain language, pick a model stack, and watch the quartet build it live. Then download it as a zip.

## Repo layout

```
agents/        the four Band agents (spec, coder, tester, repairer)
orchestrator/  room driver, model selection, live run launcher, demo server
bench/         dataset, sandbox, scorer, baselines, reporting
prompts/       agent system prompts (race and build)
web/           React + Vite + Tailwind judge-facing UI
```

## Setup

You need Python 3.11+ and [uv](https://github.com/astral-sh/uv).

```
uv sync
cp .env.example .env                       # set LLM_PROVIDER and any API keys
cp agent_config.example.yaml agent_config.yaml   # set Band agent ids and keys
```

## Run it

```
uv run python -m agents.spec            # start each agent in its own process
uv run python -m orchestrator.conductor # run the quartet over the benchmark
uv run python -m bench.baselines        # run single-model baselines
uv run python -m bench.report           # build the results table and chart
```

## Run the live demo

```
uv run python -m orchestrator.demo_server   # judge-facing demo server
cd web && npm install && npm run dev        # frontend dev server
```

Or use one command:

```
./start.sh            # opens the demo server and frontend in terminals
./start.sh build      # build once, serve everything from one port
```

## How models are served

Live runs use two local model servers: the large competitor on port 8080 and the four small agents on port 8081. The agents stay real Band agents in every mode. Only their model endpoint changes. You can also point any agent at a hosted provider (Groq, AI/ML API, or any OpenAI-compatible endpoint) from the dashboard.

## Notes

- Generated code is untrusted. It only ever runs in a temp dir sandbox with a timeout, never against your real files.
- Secrets stay in `.env` and `agent_config.yaml`. Both are gitignored. Keys are never printed or committed.

Built for a hackathon, Track 2: Multi-Agent Software Development.

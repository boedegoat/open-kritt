# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Security researchers and security-minded developers who self-host open·kritt to hunt
for real vulnerabilities in code they have access to (their own repos, remote/local
targets they're authorized to test). They operate the stack themselves — running scans,
building and editing workflows, reviewing and validating findings — on a dedicated
Docker host or VM they control, not a managed SaaS someone else administers for them.

## Product Purpose

open·kritt orchestrates AI agents (Codex, Claude Code) into focused, well-defined
security-research tasks, runs them in parallel across a codebase, and combines the
output into de-duplicated, ranked, actionable findings. Success is a validated
vulnerability finding a researcher can trust and act on, not a wall of unverified model
output.

## Positioning

The core mechanism: break research into small, well-defined prompts/tasks chained into
reusable workflows, run them across agents in parallel, then de-duplicate and rank the
combined output with configurable severity rankers and post-scripts (validation, PoC
generation, reporting). This is the differentiator over "point a model at the whole
repo and hope" — decomposition and verification, not raw model scale.

## Operating Context

- Self-hosted via Docker Compose (`./kritt setup`, `./kritt start`); frontend served at
  `localhost:5173`, docs previewed separately via Mint at `localhost:3001`.
- Core objects a user works with: **workflows** (chains of prompt steps), **scans**
  (a workflow run against a remote or local repo + dependencies), **findings/
  vulnerabilities** (de-duplicated, severity-ranked output of a scan), **post-scripts**
  (validation/PoC/report generation), **severity rankers**, **agent skills**, and
  **accounts** (model-provider/API credentials).
- Tool-enabled agents run as root inside disposable per-job containers with a writable
  repo checkout and direct internet access, so they can install tools, compile targets,
  run tests, and build PoCs. This is a deliberate, documented risk tradeoff (see
  `docs/threat-model.md`) — the operator is expected to run the stack on a dedicated,
  isolated host, not general-purpose infrastructure.
- Bring-your-own model access: Codex login, or API keys for OpenAI, Anthropic, or
  OpenRouter.

## Capabilities and Constraints

- Build reusable workflows by chaining focused prompt steps.
- Run scans against remote or local repositories and their dependencies using Codex or
  Claude Code as the underlying agent.
- Validate findings and build proofs of concept via post-scripts.
- Prioritize results with custom severity rankers, a consistent finding schema, and
  automatic de-duplication.
- Authenticated, multi-user access (login) is now a real, durable product capability
  (in active development on the `with-login` branch) — treat auth/session state as
  something future UI work should account for, not an edge case. (Note: this
  supersedes the older README claim that "the backend does not include application
  authentication"; that line is now stale relative to product direction.)
- Constraint: the platform is explicitly not hardened for running against untrusted
  code on shared/production infrastructure — the threat model assumes a dedicated,
  disposable host.

## Brand Commitments

- Name: **open·kritt** (styled with the middle dot), part of the Kritt project.
- Logo: light/dark variants at `docs/images/logo-{light,dark}.png`.
- License: AGPL-3.0.
- Team credibility asset: built by the team behind the "Blockian" researcher identity,
  with $1.5M+ in bug-bounty payouts — an existing proof point, not something to
  fabricate further claims around.

## Evidence on Hand

- Real product screenshot: `assets/workflow_screen.png` (workflow builder UI).
- Logo assets: `docs/images/logo-light.png`, `docs/images/logo-dark.png`.
- No testimonials, case studies, or customer logos exist — do not fabricate any.

## Product Principles

1. Decomposition over brute force — small, well-defined tasks in parallel beat one
   model pointed at an entire repo.
2. Verified over raw — findings are validated, de-duplicated, and ranked, not just
   surfaced.
3. Operator-controlled — self-hosted, bring-your-own-model, runs on infrastructure the
   researcher owns and configures.
4. Transparent risk — the agentic execution model (root, internet access, disposable
   containers) is documented, not hidden; the UI should not obscure that this is
   powerful, security-sensitive tooling.

## Accessibility & Inclusion

No product-specific accessibility requirement has been established yet.

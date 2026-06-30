# Orchestrated Agent Workflow Vision

This document defines the target product and architecture direction for
CodexMonitor.

CodexMonitor is an app-server-centric product for orchestrated agent workflows.
The app uses Codex app-server as the execution and protocol substrate, then
builds workflow, automation, configuration, and UI layers around it.

## Product North Star

CodexMonitor evolves from a multi-thread Codex monitor into an orchestrated
agent workflow product.

The product experience is organized around outcomes and workflows instead of
raw conversation management alone. Users should be able to move from a
requirement to a plan, clarification, implementation, validation, review, and
final result while CodexMonitor manages the underlying Codex threads, turns,
background runs, events, and configuration.

Representative workflow:

```text
Requirement
  -> planning run
  -> clarification request or plan ready
  -> user approval
  -> implementation run
  -> validation and review
  -> final artifact or follow-up task
```

Threads remain the underlying Codex primitive, but workflows are the product
primitive.

## Core Architecture Position

CodexMonitor depends on the Codex binary to start `codex app-server`, but the
runtime agent integration is with the app-server JSON-RPC protocol, not the
regular Codex CLI interaction model.

The main integration model is:

```text
CodexMonitor UI
  -> Tauri service boundary
    -> Rust app or daemon adapter
      -> shared backend workflow/core layer
        -> Codex app-server JSON-RPC
          -> Codex agent runtime
```

The regular Codex CLI surface is limited to support tasks such as version
checks, app-server capability checks, update/install detection, and
configuration/state file access. Interactive agent work is driven through
app-server requests and notifications.

## App-Server Is The Center

Codex app-server is the source of truth for rich agent execution in
CodexMonitor.

App-server provides the protocol substrate for:

- authentication and account state
- conversation history
- threads, turns, and items
- streamed agent events
- approvals and server requests
- model, skills, apps, and MCP status surfaces exposed by the protocol

CodexMonitor should continue expanding app-server protocol coverage before
inventing parallel execution paths.

## Primitive Taxonomy

CodexMonitor distinguishes agent capability primitives from product primitives.

Agent capability primitives are the underlying Codex capabilities that make
agent execution powerful and configurable:

- Codex app-server
- skills
- MCP
- rules
- hooks
- Codex configuration
- approvals and sandbox policy
- worktrees and execution isolation

These capabilities belong close to Codex runtime and app-server integration.
They should be exposed, configured, composed, and respected by CodexMonitor, but
not redefined as CodexMonitor-only concepts.

Product primitives are the higher-level concepts CodexMonitor builds from
agent capabilities:

- workflows
- planning runs
- implementation runs
- automation runs
- clarification requests
- triage inbox items
- review milestones
- artifacts
- follow-up tasks

Product primitives define the user experience and persisted workflow state.
They are implemented by orchestrating app-server threads, turns, events, skills,
MCP, rules, hooks, configuration, approvals, sandboxing, and worktrees.

Protocol parity is tracked in:

- `docs/app-server-events.md`
- `src-tauri/src/shared/codex_core.rs`
- `src-tauri/src/codex/mod.rs`
- `src-tauri/src/bin/codex_monitor_daemon/rpc/*`
- `src/utils/appServerEvents.ts`
- `src/features/app/hooks/useAppServerEvents.ts`

When adding app-server support, update parsing, routing, app adapter, daemon
adapter, shared core behavior, and documentation together.

## Product Layers

CodexMonitor should separate raw protocol operations from product workflows.

Target backend layering:

```text
src-tauri/src/shared/codex_core.rs
  Raw app-server request helpers and response handling.

src-tauri/src/shared/codex_aux_core.rs
  Focused helper operations that are still backed by app-server.

src-tauri/src/shared/codex_runtime_core.rs
  Codex configuration, skill, MCP, rule, and capability discovery concerns.

src-tauri/src/shared/workflow_core.rs
  Product-level workflow orchestration shared by app and daemon.

src-tauri/src/shared/planning_core.rs
  Planning-specific background runs, clarification state, and plan readiness.
```

The exact module names can evolve, but the boundary should stay clear:

- `codex_core.rs` stays close to the app-server protocol.
- workflow cores own product semantics.
- app and daemon modules stay thin adapters.
- frontend services stay the only Tauri IPC call sites.

## Skills Strategy

Skills are agent capability primitives and first-class workflow building
blocks.

CodexMonitor should use skills for reusable, task-specific agent workflows,
including:

- planning
- implementation decomposition
- review
- migration
- triage
- data engineering planning
- release readiness
- domain-specific analysis

The UI should expose skills as workflow templates and task capabilities, not
only as composer autocomplete tokens.

Skill selection can be explicit, by user choice or `$skill-name`, or implicit,
through Codex skill matching. CodexMonitor should preserve the underlying Codex
skill model while adding workflow-aware UI affordances around it.

## Automation Strategy

Automations are a product concept built around app-server-backed background
runs.

CodexMonitor automations should support:

- scheduled or user-triggered background work
- project-local or worktree-isolated execution
- skill-backed prompts
- silent progress while work is not actionable
- surfaced states for clarification, findings, failure, completion, and review
- a triage or inbox-style view for runs that require attention

Implementation should remain app-server-centric:

```text
automation scheduler
  -> choose project/worktree/runtime settings
  -> start or resume app-server thread
  -> start turn with workflow prompt or skill invocation
  -> listen to app-server notifications
  -> persist workflow state
  -> surface only actionable user states
```

If app-server exposes first-class automation APIs, CodexMonitor should use
them. If not, CodexMonitor owns the scheduling and workflow state while Codex
app-server owns execution.

## Planning Workflow Strategy

Planning is a first-class workflow.

A planning run should be able to execute in the background and stay quiet until
one of these states occurs:

- clarification required
- plan ready
- plan failed
- plan canceled

Planning should not pollute the primary user-facing thread with noisy
intermediate output. Background thread events can be collected, summarized, and
mapped into workflow state.

The planning workflow should support:

- selected skill or default planning prompt
- model, reasoning, sandbox, and approval settings
- optional worktree isolation
- clarification requests
- plan acceptance or revision
- transition into implementation workflow

## Configuration Strategy

Codex configuration is an agent capability primitive and part of the product
surface.

CodexMonitor should manage and explain Codex runtime configuration through a
dedicated layer rather than scattered settings code. Relevant configuration
includes:

- `CODEX_HOME`
- `config.toml`
- project `.codex/config.toml`
- model and reasoning defaults
- approval policy
- sandbox policy
- feature flags
- skills configuration
- MCP servers
- rules and hooks
- provider settings where appropriate

Configuration edits must preserve Codex semantics and respect trusted-project,
user-level, and project-level boundaries.

## UI Strategy

The UI should be redesigned around workflow state and user decisions.

The current thread/workspace model remains useful, but the primary interaction
model should become:

- choose or describe an outcome
- select workflow mode, skill, model, and isolation policy when needed
- let background work proceed quietly
- surface clarification and approval requests at the right time
- present plans, diffs, validation, and artifacts as reviewable milestones
- make it easy to continue, revise, approve, archive, or convert work into a
  follow-up workflow

The UI should make app-server-driven work understandable without exposing raw
protocol mechanics to the user.

## App And Daemon Parity

Workflow behavior must work through both local app mode and remote daemon mode
unless it is intentionally app-only.

For every shared backend workflow:

1. Put domain behavior in `src-tauri/src/shared/*`.
2. Add or update the Tauri app command adapter.
3. Add or update daemon JSON-RPC handling.
4. Update frontend IPC wrappers.
5. Update typed contracts and tests.

The daemon is a remote adapter over the same product and app-server substrate,
not a separate workflow implementation.

## Protocol Schema Strategy

Codex app-server protocol coverage should be version-aware.

When upgrading protocol support, generate or inspect version-matched schemas
from the installed Codex version where useful:

```bash
codex app-server generate-ts --out ./schemas
codex app-server generate-json-schema --out ./schemas
```

Generated schemas can inform typed parsing, missing event audits, and contract
tests. They should not replace the existing app/daemon/shared architecture.

## Implementation Principles

- Keep Codex app-server as the execution center.
- Keep raw app-server protocol helpers separate from workflow orchestration.
- Build workflows as shared backend cores first.
- Keep app and daemon as thin adapters.
- Treat app-server, skills, MCP, rules, hooks, Codex configuration, approvals,
  sandboxing, and worktrees as agent capability primitives.
- Treat workflows, planning runs, implementation runs, automation runs,
  clarification requests, triage items, review milestones, artifacts, and
  follow-up tasks as product primitives.
- Prefer background app-server threads for hidden planning and helper runs.
- Surface only actionable workflow states unless the user asks for detailed
  trace output.
- Preserve existing JSON-RPC and IPC contracts unless intentionally changing
  them.
- Update `docs/app-server-events.md` whenever app-server protocol behavior
  changes.

## Non-Goals

CodexMonitor should not become a wrapper around the human-facing Codex CLI.

CodexMonitor should not duplicate Codex runtime behavior that app-server already
provides.

CodexMonitor should not put product workflow orchestration directly into
frontend components when the behavior must also work in daemon or remote mode.

CodexMonitor should not let `codex_core.rs` become an unbounded product-workflow
module. It remains close to app-server requests, responses, and shared protocol
helpers.

## Canonical References

- App-server protocol parity: `docs/app-server-events.md`
- Task-oriented repo map: `docs/codebase-map.md`
- Backend app-server bridge: `src-tauri/src/backend/app_server.rs`
- Raw Codex shared core: `src-tauri/src/shared/codex_core.rs`
- Codex helper core: `src-tauri/src/shared/codex_aux_core.rs`
- App command adapter: `src-tauri/src/codex/mod.rs`
- Daemon RPC adapter: `src-tauri/src/bin/codex_monitor_daemon/rpc/*`
- Frontend app-server parsing: `src/utils/appServerEvents.ts`
- Frontend app-server routing: `src/features/app/hooks/useAppServerEvents.ts`

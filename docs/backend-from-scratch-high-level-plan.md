# Client-Agnostic Backend From-Scratch Plan

## Purpose

This plan describes a from-scratch backend architecture for a CodexMonitor-like system. The backend is designed as a client-agnostic platform that can support desktop, web, CLI, mobile, automation, and embedded clients without making any one client transport the source of truth.

Tauri may be used as a desktop transport example, but the backend design must stand independently from Tauri.

## Design Principles

| Principle | Requirement |
| --- | --- |
| Protocol first | Define stable commands, responses, events, errors, and lifecycle rules before choosing transports. |
| Client agnostic | No backend behavior may depend on a specific UI framework, desktop shell, or transport. |
| Ports and adapters | The backend core exposes internal ports; transports and external services are adapters. |
| Event native | Long-running work is modeled as command responses plus event streams, not as blocking requests. |
| Typed boundaries | Every public command, event, and server request has an explicit schema. |
| Versioned contracts | Public protocol changes are versioned and backward-compatible where possible. |
| Single ownership | Command handling, session management, routing, persistence, and normalization each have one owner. |
| Deterministic routing | Every request and event has enough identity to route to tenant, workspace, thread, turn, and client. |
| Observable by default | Requests, responses, events, errors, and session transitions are traceable. |
| Adapter parity | Tauri, HTTP, WebSocket, daemon RPC, and CLI adapters must call the same backend use cases. |

## Architecture Pattern

The backend should use Hexagonal Architecture, also known as Ports and Adapters.

```text
Clients and transports
  depend on
Application protocol
  depends on
Backend application core
  depends on
Domain services and ports
  implemented by
Infrastructure adapters
```

The critical dependency rule:

```text
Transport adapters depend on the backend core.
The backend core does not depend on transport adapters.
```

## High-Level Architecture

```text
                       +-----------------------------+
                       | Clients                     |
                       | Web / Desktop / CLI / API   |
                       +--------------+--------------+
                                      |
                                      | Public protocol
                                      v
                       +-----------------------------+
                       | Client SDKs                 |
                       | Type-safe command/event API |
                       +--------------+--------------+
                                      |
                                      | Transport binding
                                      v
+----------------+     +-----------------------------+     +----------------+
| Tauri Adapter  |     | Backend Edge / Gateway      |     | HTTP/WS Adapter|
| Example only   +---->| Auth, validation, routing   |<----+ JSON-RPC, SSE  |
+----------------+     +--------------+--------------+     +----------------+
                                      |
                                      | Internal command bus
                                      v
                       +-----------------------------+
                       | Application Core            |
                       | Use cases, sessions, turns  |
                       +--------------+--------------+
                                      |
                    +-----------------+-----------------+
                    |                                   |
                    v                                   v
       +-------------------------+        +---------------------------+
       | Domain Services         |        | Event Bus / Projection    |
       | Workspaces, threads,    |        | Fanout, ordering, replay  |
       | turns, approvals        |        +-------------+-------------+
       +------------+------------+                      |
                    |                                   v
                    v                     +---------------------------+
       +-------------------------+        | State Stores              |
       | External Service Ports  |        | Threads, sessions, audit  |
       | Codex app-server, git,  |        +---------------------------+
       | filesystem, auth        |
       +-------------------------+
```

## Core Components

| Component | Responsibility | Must Not Do |
| --- | --- | --- |
| Public protocol | Defines commands, responses, events, errors, versions, and compatibility rules. | Contain transport-specific concepts. |
| Client SDK | Provides typed client access to commands, events, and server-request responses. | Own backend business logic. |
| Transport adapters | Convert Tauri, HTTP, WebSocket, JSON-RPC, or CLI calls into protocol commands. | Interpret domain behavior differently per client. |
| Backend gateway | Authenticates, validates, rate limits, resolves context, and dispatches commands. | Duplicate application use cases. |
| Application core | Owns command handling, workflow orchestration, session lifecycle, and event publishing. | Depend on Tauri, React, WebSocket, or CLI. |
| Domain services | Own workspace, thread, turn, approval, account, and model behavior. | Emit UI-specific state. |
| External service adapters | Integrate with Codex app-server, filesystem, git, auth, and persistence. | Leak upstream protocol quirks into clients. |
| Event bus | Publishes ordered events to subscribed clients and projections. | Mutate domain state directly. |
| Projection stores | Maintain queryable read models for thread lists, active turns, audit history, and client recovery. | Become the write-side source of truth. |

## Protocol Boundary

The public backend protocol has three message families:

1. Client command requests
2. Backend command responses
3. Backend events, including server requests that require a client response

### Command Request Envelope

```json
{
  "protocolVersion": "1.0",
  "id": "req_01HZY9K8V9",
  "tenantId": "tenant_123",
  "workspaceId": "workspace_456",
  "clientId": "client_789",
  "method": "turn/start",
  "params": {},
  "metadata": {
    "traceId": "trace_abc",
    "idempotencyKey": "idem_optional"
  }
}
```

### Command Response Envelope

```json
{
  "protocolVersion": "1.0",
  "id": "req_01HZY9K8V9",
  "ok": true,
  "result": {},
  "metadata": {
    "traceId": "trace_abc"
  }
}
```

### Error Response Envelope

```json
{
  "protocolVersion": "1.0",
  "id": "req_01HZY9K8V9",
  "ok": false,
  "error": {
    "code": "THREAD_NOT_FOUND",
    "message": "Thread was not found.",
    "retryable": false,
    "details": {}
  },
  "metadata": {
    "traceId": "trace_abc"
  }
}
```

### Event Envelope

```json
{
  "protocolVersion": "1.0",
  "eventId": "evt_01HZY9M2YE",
  "tenantId": "tenant_123",
  "workspaceId": "workspace_456",
  "threadId": "thread_123",
  "turnId": "turn_456",
  "sequence": 108,
  "method": "item/agentMessage/delta",
  "params": {},
  "metadata": {
    "traceId": "trace_abc",
    "createdAt": "2026-06-30T00:00:00Z"
  }
}
```

### Server Request Event Envelope

Server requests are events that require a client response.

```json
{
  "protocolVersion": "1.0",
  "eventId": "evt_01HZY9PBKH",
  "requestId": "srvreq_01HZY9PZ2A",
  "tenantId": "tenant_123",
  "workspaceId": "workspace_456",
  "threadId": "thread_123",
  "turnId": "turn_456",
  "sequence": 112,
  "method": "item/tool/requestUserInput",
  "params": {},
  "responseRequired": true,
  "expiresAt": "2026-06-30T00:05:00Z"
}
```

### Server Request Response Envelope

```json
{
  "protocolVersion": "1.0",
  "requestId": "srvreq_01HZY9PZ2A",
  "tenantId": "tenant_123",
  "workspaceId": "workspace_456",
  "clientId": "client_789",
  "result": {},
  "metadata": {
    "traceId": "trace_abc"
  }
}
```

## Method Namespace Rules

Method names should be stable, human-readable, and grouped by domain.

| Namespace | Purpose | Examples |
| --- | --- | --- |
| `thread/*` | Thread lifecycle and thread state access. | `thread/start`, `thread/read`, `thread/list` |
| `turn/*` | Turn lifecycle and active agent work. | `turn/start`, `turn/interrupt`, `turn/completed` |
| `item/*` | Streamed items inside a thread or turn. | `item/started`, `item/completed`, `item/agentMessage/delta` |
| `account/*` | Account state, auth, and rate limits. | `account/read`, `account/updated` |
| `model/*` | Model discovery and capability metadata. | `model/list` |
| `workspace/*` | Workspace discovery and configuration. | `workspace/list`, `workspace/read` |
| `serverRequest/*` | Client responses to backend-originated requests. | `serverRequest/respond` |
| `system/*` | Backend capabilities, health, and protocol metadata. | `system/capabilities`, `system/health` |

Rules:

- Commands use action names such as `start`, `read`, `list`, `set`, `archive`, or `respond`.
- Events use past-tense or state-change names such as `started`, `completed`, `updated`, or `changed`.
- Streaming events use suffixes such as `delta`, `outputDelta`, or `textDelta`.
- Server requests must include a stable `requestId`.
- Deprecated methods remain documented until their removal version.

## Canonical Command Groups

| Group | Required Commands |
| --- | --- |
| System | `system/capabilities`, `system/health` |
| Workspace | `workspace/list`, `workspace/read`, `workspace/config/read`, `workspace/config/update` |
| Thread | `thread/start`, `thread/resume`, `thread/read`, `thread/list`, `thread/fork`, `thread/archive`, `thread/name/set` |
| Turn | `turn/start`, `turn/steer`, `turn/interrupt` |
| Review | `review/start` |
| Models | `model/list` |
| Features | `experimentalFeature/list`, `collaborationMode/list` |
| Account | `account/read`, `account/rateLimits/read`, `account/login/start`, `account/login/cancel` |
| Skills and apps | `skills/list`, `app/list` |
| Server requests | `serverRequest/respond` |

## Canonical Event Groups

| Group | Required Events |
| --- | --- |
| Connection | `system/connected`, `system/disconnected`, `system/reconnecting` |
| Thread | `thread/started`, `thread/status/changed`, `thread/name/updated`, `thread/closed`, `thread/archived`, `thread/unarchived` |
| Turn | `turn/started`, `turn/plan/updated`, `turn/diff/updated`, `turn/completed` |
| Items | `item/started`, `item/completed` |
| Assistant output | `item/agentMessage/delta` |
| Reasoning | `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded` |
| Tools | `item/commandExecution/outputDelta`, `item/commandExecution/terminalInteraction`, `item/fileChange/outputDelta` |
| Hooks | `hook/started`, `hook/completed` |
| Account | `account/updated`, `account/rateLimits/updated`, `account/login/completed` |
| Apps and skills | `app/list/updated`, `skills/list/updated` |
| Server requests | approval request methods, `item/tool/requestUserInput` |
| Errors | `error` |

## Request Flow

```text
Client action
  |
  v
Client SDK builds command envelope
  |
  v
Transport adapter sends envelope
  |
  v
Backend gateway authenticates and validates
  |
  v
Gateway resolves tenant, workspace, client, and permissions
  |
  v
Application core dispatches command to use case
  |
  v
Domain service executes workflow
  |
  v
External service adapter calls Codex app-server or another dependency
  |
  v
Backend returns command response
  |
  v
Client receives success or error
```

## Event Flow

```text
External service, domain service, or application workflow emits event
  |
  v
Application core normalizes event
  |
  v
Event bus assigns sequence and persistence policy
  |
  v
Projection store updates read models
  |
  v
Subscription manager fans event out to authorized clients
  |
  v
Client SDK receives typed event
  |
  v
Client state projection updates UI or automation state
```

## Server Request Flow

```text
Backend needs client decision or input
  |
  v
Backend emits server-request event with requestId
  |
  v
Event bus routes request to eligible clients
  |
  v
Client shows approval, prompt, or automation hook
  |
  v
Client responds with serverRequest/respond
  |
  v
Gateway validates request ownership and expiry
  |
  v
Application core resumes blocked workflow
  |
  v
Workflow emits follow-up events
```

## Transport Strategy

| Transport | Use Case | Notes |
| --- | --- | --- |
| WebSocket | Primary bidirectional client transport. | Best fit for commands, responses, streaming events, and server requests. |
| HTTP + SSE | Web-friendly alternative. | HTTP for commands, SSE for events; server-request responses use HTTP. |
| JSON-RPC over stdio/socket | Daemon and local automation. | Useful for local processes and supervised agents. |
| Tauri invoke + events | Desktop shell integration example. | Adapter over the same protocol, not a separate backend API. |
| CLI | Scripting and diagnostics. | Should use the same command names and response envelopes. |

## State Ownership

| State Type | Write Owner | Read/Projection Owner |
| --- | --- | --- |
| Workspace registry | Workspace domain service | Workspace read model |
| Thread metadata | Thread domain service | Thread list projection |
| Thread items | Turn/item domain services | Thread detail projection |
| Active turn status | Turn domain service | Active turn projection |
| Approval state | Server request service | Pending request projection |
| Account state | Account domain service | Account projection |
| Capability metadata | System service | Capability cache |
| Audit log | Event bus or audit service | Audit queries |

## Persistence Requirements

The backend should separate durable source-of-truth data from derived projections.

| Store | Purpose |
| --- | --- |
| Event log | Ordered record of backend events needed for replay, diagnostics, and recovery. |
| Session store | Active backend sessions, app-server connections, and pending requests. |
| Projection store | Query-optimized thread lists, active turns, pending approvals, and account snapshots. |
| Configuration store | Workspace, account, model, and feature configuration. |
| Audit store | Security-relevant decisions, approvals, commands, and errors. |

## Reliability Requirements

| Requirement | Description |
| --- | --- |
| Idempotency | Mutating commands should accept idempotency keys where duplicate submission is likely. |
| Ordered events | Events should include per-thread or per-workspace sequence numbers. |
| Replay support | Clients should be able to resume from a known sequence where feasible. |
| Backpressure | Streaming events must not unboundedly buffer for slow clients. |
| Timeouts | Commands and server requests need explicit timeout behavior. |
| Cancellation | Long-running turns and external calls need cancellation paths. |
| Recovery | Backend restart should recover durable state and clearly mark interrupted active work. |
| Error taxonomy | Errors should be stable, typed, and retry-aware. |

## Security Requirements

| Requirement | Description |
| --- | --- |
| Authentication | Every client must establish identity before command execution. |
| Authorization | Workspace, thread, account, and approval actions require permission checks. |
| Request ownership | Server-request responses must be accepted only from authorized clients. |
| Input validation | All public protocol payloads must be schema validated. |
| Secret isolation | Tokens and credentials must not be emitted through event payloads. |
| Auditability | Approvals, denied actions, login events, and sensitive commands must be audited. |
| Transport security | Remote transports require TLS or equivalent secure channel assumptions. |

## Observability Requirements

The backend should emit structured telemetry for:

- Command received
- Command validated
- Command dispatched
- External service request started and completed
- Event published
- Event delivered
- Server request opened, answered, expired, or canceled
- Error response generated
- Session opened, closed, or recovered

Required correlation fields:

- `traceId`
- `requestId`
- `eventId`
- `tenantId`
- `workspaceId`
- `threadId` when available
- `turnId` when available
- `clientId`

## Client SDK Requirements

Every client SDK should expose the same conceptual interface:

```ts
interface BackendClient {
  call<TResponse>(method: string, params: unknown): Promise<TResponse>;
  subscribe(handler: (event: BackendEvent) => void): () => void;
  respond(requestId: string, result: unknown): Promise<void>;
  capabilities(): Promise<BackendCapabilities>;
}
```

SDK responsibilities:

- Build protocol envelopes
- Attach client identity and trace metadata
- Normalize transport errors into protocol errors
- Reconnect and resume event streams where supported
- Preserve method names and payload semantics exactly

SDKs must not:

- Implement backend authorization rules
- Rewrite domain events into client-specific meanings
- Depend on a specific UI state model

## External Service Boundary

The Codex app-server or any equivalent agent runtime should be treated as an external dependency behind a port.

```text
Application Core
  |
  v
Agent Runtime Port
  |
  v
Codex App-Server Adapter
```

The adapter owns:

- Translating backend protocol commands into app-server requests
- Translating app-server notifications into backend events
- Correlating app-server request IDs with backend request IDs
- Normalizing upstream errors
- Hiding upstream schema drift from clients

## Contract Testing Requirements

The backend should include tests for:

- Command envelope validation
- Response envelope shape
- Event envelope shape
- Method registry completeness
- Protocol version compatibility
- Transport adapter parity
- Server-request lifecycle
- Event ordering and replay
- Error code stability
- Capability discovery accuracy

Transport parity tests should prove that these paths dispatch to the same use cases:

```text
Tauri command -> backend use case
WebSocket command -> backend use case
HTTP command -> backend use case
Daemon JSON-RPC command -> backend use case
CLI command -> backend use case
```

## Implementation Phases

### Phase 1: Protocol Definition

- Define protocol versioning rules.
- Define command, response, event, error, and server-request envelopes.
- Define method namespace rules.
- Define schema ownership and generation strategy.
- Define capability discovery response.

### Phase 2: Backend Core

- Implement command dispatcher.
- Implement event publisher.
- Implement workspace and session routing.
- Implement server-request manager.
- Implement typed error taxonomy.
- Implement in-memory stores for first development pass.

### Phase 3: External Runtime Adapter

- Implement agent runtime port.
- Implement Codex app-server adapter.
- Normalize app-server requests, responses, notifications, and errors.
- Add app-server protocol compatibility tests.

### Phase 4: Transports

- Implement WebSocket transport.
- Implement HTTP command endpoint and SSE event stream if needed.
- Implement daemon JSON-RPC transport.
- Implement Tauri desktop transport as an adapter example.
- Implement CLI transport for diagnostics.

### Phase 5: Persistence And Recovery

- Add durable event log.
- Add session recovery strategy.
- Add projection stores.
- Add replay and resume support.
- Add audit logging.

### Phase 6: Client SDKs

- Implement TypeScript SDK.
- Add optional Rust or CLI SDK if needed.
- Add transport implementations behind the SDK.
- Add reconnect, resume, and server-request helpers.

### Phase 7: Hardening

- Add auth and authorization.
- Add rate limiting and backpressure.
- Add structured telemetry.
- Add protocol conformance tests.
- Add load and failure-mode tests.

## Acceptance Criteria

The from-scratch backend is ready when:

- The public protocol is documented and versioned.
- Commands, responses, events, errors, and server requests have schemas.
- At least two transports use the same backend command dispatcher.
- Tauri, if present, is only a transport adapter.
- Clients can subscribe to events and respond to server requests.
- Event ordering and replay behavior are documented.
- The Codex app-server integration is isolated behind an adapter.
- Contract tests protect protocol stability.
- A new client can be added without changing backend use-case code.

## Final Architecture Rule

```text
The backend product is the protocol plus the application core.
Every client and transport is an adapter.
Every external runtime is an adapter.
Protocol boundaries are explicit, typed, versioned, and tested.
```

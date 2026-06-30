# Backend System Design Requirement Plan

## Purpose

This plan defines how to separate the backend into a client-agnostic system while preserving the existing CodexMonitor command, response, and event model. Tauri remains a supported desktop transport example, but the backend contract must not depend on Tauri-specific behavior.

## Architecture Pattern

The target architecture is a client-agnostic backend using:

- Hexagonal Architecture, also known as Ports and Adapters
- Adapter Pattern for transports such as Tauri, daemon JSON-RPC, WebSocket, HTTP, CLI, or mobile clients
- JSON-RPC-style request/response commands
- Event-driven notifications for long-running agent and thread activity

The core rule is:

```text
Client transports do not own backend behavior.
Shared backend core owns command handling, session behavior, app-server routing, and protocol normalization.
```

## Current System Interpretation

The current system already has the beginning of a ports-and-adapters shape:

| Architecture Concept | Current Location |
| --- | --- |
| UI client | `src/features/*` |
| Frontend IPC wrapper | `src/services/tauri.ts` |
| Desktop transport adapter | `src-tauri/src/lib.rs`, `src-tauri/src/codex/mod.rs` |
| Daemon transport adapter | `src-tauri/src/bin/codex_monitor_daemon/rpc.rs`, `src-tauri/src/bin/codex_monitor_daemon/rpc/*` |
| Shared backend core | `src-tauri/src/shared/codex_core.rs` |
| App-server session layer | `src-tauri/src/backend/app_server.rs` |
| Event sink | `src-tauri/src/event_sink.rs` |
| Frontend event hub | `src/services/events.ts` |
| Frontend event router | `src/utils/appServerEvents.ts`, `src/features/app/hooks/useAppServerEvents.ts` |

## Target High-Level Architecture

```text
                +---------------------------+
                | Web / Desktop / CLI /     |
                | Mobile / Automation       |
                +-------------+-------------+
                              |
                              | Stable backend protocol
                              v
                +---------------------------+
                | Client SDK / API Wrapper  |
                +-------------+-------------+
                              |
                              | Transport adapter
                              | Tauri invoke / WebSocket /
                              | HTTP / JSON-RPC / CLI
                              v
                +---------------------------+
                | Backend Gateway           |
                | Command + Event Contract  |
                +-------------+-------------+
                              |
                              | Internal backend port
                              v
                +---------------------------+
                | Shared Backend Core       |
                | Commands, Sessions,       |
                | Routing, Normalization    |
                +-------------+-------------+
                              |
                              | Codex app-server protocol
                              v
                +---------------------------+
                | Codex App-Server          |
                | thread/*, turn/*, etc.    |
                +---------------------------+
```

## Backend Boundary Requirement

The backend boundary should be a stable command and event protocol, not a Tauri command list.

Recommended canonical command shape:

```json
{
  "workspaceId": "workspace-id",
  "method": "turn/start",
  "params": {}
}
```

Recommended canonical event shape:

```json
{
  "workspaceId": "workspace-id",
  "method": "turn/started",
  "params": {},
  "requestId": null
}
```

Recommended server-request event shape:

```json
{
  "workspaceId": "workspace-id",
  "requestId": 42,
  "method": "item/tool/requestUserInput",
  "params": {}
}
```

Recommended server-request response shape:

```json
{
  "requestId": 42,
  "result": {}
}
```

## Core Design Requirements

| Requirement | Description |
| --- | --- |
| Client agnostic | Backend commands and events must work for desktop, web, CLI, daemon, and automation clients. |
| Transport neutral | Tauri, WebSocket, HTTP, JSON-RPC, and CLI are adapters around the same backend contract. |
| Shared core first | Backend behavior belongs in `src-tauri/src/shared/*` or an equivalent shared backend crate/module. |
| Stable method names | Canonical method names should follow app-server-style names such as `thread/start`, `turn/start`, and `model/list`. |
| Event first-class support | Streaming events and server requests are part of the public backend contract, not incidental UI behavior. |
| Request correlation | Commands and server requests need stable request IDs for matching responses. |
| Versioned protocol | The backend protocol should include a version marker or versioned endpoint namespace. |
| Capability discovery | Clients should be able to ask which commands, events, and features are supported. |
| Adapter parity | Tauri, daemon, and future transports must route to the same shared backend implementation. |
| Typed contracts | Request, response, and event schemas should be defined once and shared or generated across Rust and TypeScript. |

## Canonical Command Surface

The canonical command surface should be expressed in backend protocol method names.

Examples:

| Area | Canonical Methods |
| --- | --- |
| Thread lifecycle | `thread/start`, `thread/resume`, `thread/read`, `thread/list`, `thread/fork`, `thread/archive`, `thread/name/set` |
| Turn lifecycle | `turn/start`, `turn/steer`, `turn/interrupt` |
| Review | `review/start` |
| Models and features | `model/list`, `experimentalFeature/list`, `collaborationMode/list` |
| Account | `account/read`, `account/rateLimits/read`, `account/login/start`, `account/login/cancel` |
| Skills and apps | `skills/list`, `app/list` |
| Server request response | `serverRequest/respond` or equivalent response path keyed by request ID |

Tauri command names such as `send_user_message` or `start_thread` can continue to exist as desktop adapter methods, but they should not be the canonical backend API.

## Canonical Event Surface

Events should use the same method names regardless of client type.

Examples:

| Area | Event Methods |
| --- | --- |
| Thread lifecycle | `thread/started`, `thread/status/changed`, `thread/name/updated`, `thread/closed`, `thread/archived`, `thread/unarchived` |
| Turn lifecycle | `turn/started`, `turn/plan/updated`, `turn/diff/updated`, `turn/completed` |
| Item lifecycle | `item/started`, `item/completed` |
| Assistant streaming | `item/agentMessage/delta` |
| Reasoning streaming | `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded` |
| Tool output | `item/commandExecution/outputDelta`, `item/commandExecution/terminalInteraction`, `item/fileChange/outputDelta` |
| Server requests | approval request methods, `item/tool/requestUserInput` |
| Account and app state | `account/updated`, `account/rateLimits/updated`, `account/login/completed`, `app/list/updated` |

## High-Level Request Flow

```text
Client action
  |
  v
Client SDK calls backend method
  |
  v
Transport adapter sends command
  |
  v
Backend gateway normalizes request
  |
  v
Shared backend core handles command
  |
  v
Codex app-server receives method such as turn/start
  |
  v
Immediate command response returns
  |
  v
Client promise/request resolves
```

## High-Level Event Flow

```text
Codex app-server emits notification or server request
  |
  v
Backend session reader receives message
  |
  v
Backend wraps message in canonical event envelope
  |
  v
Transport adapter publishes event
  |
  v
Client event hub receives event
  |
  v
Client event router applies typed handlers
  |
  v
Client state updates
  |
  v
UI renders updated thread, message, approval, or account state
```

## Example: Send Message Flow

```text
User sends message
  |
  v
Client calls turn/start
  |
  v
Transport adapter forwards request
  |
  v
Shared backend core builds app-server payload
  |
  v
Codex app-server receives turn/start
  |
  v
Immediate response resolves command
  |
  v
Events stream back:
  - turn/started
  - item/started
  - item/agentMessage/delta
  - item/completed
  - turn/completed
  |
  v
Client state updates and UI renders response
```

## Transport Adapter Requirements

Each transport adapter must implement the same logical capabilities:

| Capability | Requirement |
| --- | --- |
| Call command | Send a method and params to the backend and return a response or error. |
| Subscribe to events | Deliver backend events to the client without changing method names or payload meaning. |
| Respond to server request | Send a result for a backend request ID, such as approval or user input. |
| Report connection state | Surface connected, disconnected, reconnecting, and failed states. |
| Preserve workspace context | Every command and event must include enough workspace identity for routing. |

Tauri can implement this through `invoke` and Tauri events. A web client could implement the same contract through WebSocket or HTTP plus Server-Sent Events.

## Client SDK Requirement

Clients should depend on a transport-neutral SDK interface.

Example TypeScript shape:

```ts
interface BackendClient {
  call<TResponse>(method: string, params: unknown): Promise<TResponse>;
  subscribe(handler: (event: BackendEvent) => void): () => void;
  respond(requestId: number | string, result: unknown): Promise<void>;
}
```

Tauri-specific code should live in a Tauri implementation of this interface, not inside feature components or reducers.

## Backend Gateway Requirement

The backend gateway should normalize all transports into a shared internal command shape.

Example Rust-oriented shape:

```rust
struct BackendCommand {
    workspace_id: String,
    method: String,
    params: serde_json::Value,
}

struct BackendEvent {
    workspace_id: String,
    method: String,
    params: serde_json::Value,
    request_id: Option<serde_json::Value>,
}
```

The gateway should be responsible for:

- Validating method names
- Validating request schema
- Resolving workspace context
- Calling shared backend core
- Mapping backend errors into stable protocol errors
- Publishing normalized events

## Migration Plan

1. Treat the method and event inventory as the canonical backend protocol.
2. Introduce an internal transport-neutral backend command/event model.
3. Refactor the Tauri adapter to call the transport-neutral backend API.
4. Refactor the daemon JSON-RPC adapter to call the same backend API.
5. Add a client SDK interface on the frontend.
6. Move Tauri-specific calls behind a Tauri implementation of the client SDK.
7. Add a WebSocket or JSON-RPC backend adapter for non-Tauri clients.
8. Add protocol contract tests for method names, payload schemas, response shapes, and event envelopes.
9. Add capability discovery so clients can adapt to supported backend features.
10. Version the protocol before exposing it to additional clients.

## Validation Requirements

The separation should be considered complete only when:

- The UI can call backend commands through a transport-neutral client interface.
- Tauri is one adapter, not the backend contract.
- The daemon and Tauri paths use shared backend behavior.
- Request/response commands have documented schemas.
- Streaming events have documented schemas.
- Server-request events have documented response flows.
- Contract tests verify command names and event envelopes.
- A second transport can be added without changing feature-level UI code.

## Design Principle

```text
Tauri is a transport example.
The daemon is a runtime and transport adapter.
The shared backend core plus stable command/event protocol is the backend.
```

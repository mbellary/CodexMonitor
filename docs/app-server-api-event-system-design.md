<style type="text/css">
  body, .main-container, .markdown-body {
    max-width: 100% !important; /* Changes width to fill the screen */
    width: 100%;
  }
</style>




# App-Server API And Event System Design

This document maps CodexMonitor UI calls to backend commands, daemon JSON-RPC
methods, Codex app-server request methods, app-server responses, and frontend
events.

Use this when answering:
- What command/API surfaces exist.
- How requests and responses flow.
- Which request/response methods and payload types are involved.
- How requests and responses are routed and handled.
- Where data is updated, stored, and surfaced in the UI.

Related protocol inventory:
- `docs/app-server-events.md`

## System Map

CodexMonitor has three command surfaces and one event surface.

| Layer | File | Responsibility |
| --- | --- | --- |
| UI feature code | `src/features/*` | Calls typed helpers and renders state. |
| Frontend IPC wrapper | `src/services/tauri.ts` | Owns all frontend `invoke(...)` calls and normalizes UI payloads. |
| Tauri command registry | `src-tauri/src/lib.rs` | Registers commands exposed to the frontend. |
| App backend adapter | `src-tauri/src/codex/mod.rs` | Chooses local app-server session or remote daemon backend. |
| Daemon JSON-RPC router | `src-tauri/src/bin/codex_monitor_daemon/rpc.rs`, `src-tauri/src/bin/codex_monitor_daemon/rpc/codex.rs` | Accepts remote JSON-RPC methods and forwards to shared state. |
| Shared Codex core | `src-tauri/src/shared/codex_core.rs` | Builds Codex app-server request params and sends app-server methods. |
| App-server session | `src-tauri/src/backend/app_server.rs` | Writes JSON-RPC lines to Codex, tracks pending request IDs, routes responses and notifications. |
| Backend event sink | `src-tauri/src/event_sink.rs`, `src-tauri/src/bin/codex_monitor_daemon/rpc.rs` | Emits app-server events to the frontend or remote client. |
| Frontend event hub | `src/services/events.ts` | Subscribes to Tauri event names and fans out listeners. |
| Frontend event router | `src/utils/appServerEvents.ts`, `src/features/app/hooks/useAppServerEvents.ts` | Parses app-server methods, filters supported methods, and calls app handlers. |
| State and rendering | `src/features/threads/hooks/*`, `src/utils/threadItems.ts`, `src/features/messages/components/Messages.tsx` | Applies thread, turn, item, approval, input, account, and token updates to UI state. |

Primary local request path:

```text
UI feature
-> src/services/tauri.ts
-> Tauri invoke command
-> src-tauri/src/codex/mod.rs
-> src-tauri/src/shared/codex_core.rs
-> WorkspaceSession::send_request_for_workspace(...)
-> Codex app-server JSON-RPC request
-> Codex app-server JSON-RPC response
-> original invoke Promise resolves
```

Primary remote request path:

```text
UI feature
-> src/services/tauri.ts
-> Tauri invoke command
-> src-tauri/src/codex/mod.rs
-> remote_backend::call_remote(...)
-> daemon JSON-RPC method
-> daemon shared state
-> src-tauri/src/shared/codex_core.rs
-> Codex app-server JSON-RPC request
-> daemon JSON-RPC response
-> original invoke Promise resolves
```

Primary event path:

```text
Codex app-server notification or server request
-> WorkspaceSession reader loop
-> AppServerEvent { workspace_id, message }
-> Tauri event "app-server-event"
-> src/services/events.ts
-> useAppServerEvents(...)
-> thread/account/approval/user-input handlers
-> reducers/state
-> UI
```

In remote mode, daemon events are wrapped as JSON-RPC notifications named
`app-server-event`, `terminal-output`, or `terminal-exit`. The app remote
transport re-emits those notifications as Tauri events with the same names.

## Command/API Inventory

These rows cover Codex app-server-backed commands. The Tauri command and daemon
JSON-RPC method names currently match.

| UI API | Tauri command | Daemon JSON-RPC method | Codex app-server method | Request payload | Response shape | Primary handler |
| --- | --- | --- | --- | --- | --- | --- |
| `startThread(workspaceId)` | `start_thread` | `start_thread` | `thread/start` | `workspaceId`; core adds `cwd`, `approvalPolicy` | Raw app-server response `Value` | `start_thread_core` |
| `resumeThread(workspaceId, threadId)` | `resume_thread` | `resume_thread` | `thread/resume` | `workspaceId`, `threadId` | Raw app-server response `Value` | `resume_thread_core` |
| `readThread(workspaceId, threadId)` | `read_thread` | `read_thread` | `thread/read` | `workspaceId`, `threadId` | Raw app-server response `Value` | `read_thread_core` |
| `forkThread(workspaceId, threadId)` | `fork_thread` | `fork_thread` | `thread/fork` | `workspaceId`, `threadId` | Raw app-server response `Value` | `fork_thread_core` |
| `listThreads(workspaceId, cursor, limit, sortKey)` | `list_threads` | `list_threads` | `thread/list` | `workspaceId`, optional `cursor`, `limit`, `sortKey`; core adds `sourceKinds` | Raw app-server response `Value` | `list_threads_core` |
| `archiveThread(workspaceId, threadId)` | `archive_thread` | `archive_thread` | `thread/archive` | `workspaceId`, `threadId` | Raw app-server response `Value` | `archive_thread_core` |
| `compactThread(workspaceId, threadId)` | `compact_thread` | `compact_thread` | `thread/compact/start` | `workspaceId`, `threadId` | Raw app-server response `Value` | `compact_thread_core` |
| `setThreadName(workspaceId, threadId, name)` | `set_thread_name` | `set_thread_name` | `thread/name/set` | `workspaceId`, `threadId`, `name` | Raw app-server response `Value` | `set_thread_name_core` |
| `sendUserMessage(...)` | `send_user_message` | `send_user_message` | `turn/start` | `workspaceId`, `threadId`, text, model, effort, access mode, images, service tier, collaboration mode, app mentions | Raw app-server response `Value`; turn content arrives by events | `send_user_message_core` |
| `steerTurn(...)` | `turn_steer` | `turn_steer` | `turn/steer` | `workspaceId`, `threadId`, `turnId`, text, images, app mentions | Raw app-server response `Value`; updates arrive by events | `turn_steer_core` |
| `interruptTurn(workspaceId, threadId, turnId)` | `turn_interrupt` | `turn_interrupt` | `turn/interrupt` | `workspaceId`, `threadId`, `turnId` | Raw app-server response `Value` | `turn_interrupt_core` |
| `startReview(workspaceId, threadId, target, delivery)` | `start_review` | `start_review` | `review/start` | `workspaceId`, `threadId`, review `target`, optional `delivery` | Raw app-server response `Value` | `start_review_core` |
| `getModelList(workspaceId)` | `model_list` | `model_list` | `model/list` | `workspaceId` | Raw app-server response `Value` | `model_list_core` |
| `getExperimentalFeatureList(workspaceId, cursor, limit)` | `experimental_feature_list` | `experimental_feature_list` | `experimentalFeature/list` | `workspaceId`, optional `cursor`, `limit` | Raw app-server response `Value` | `experimental_feature_list_core` |
| `getCollaborationModes(workspaceId)` | `collaboration_mode_list` | `collaboration_mode_list` | `collaborationMode/list` | `workspaceId` | Raw app-server response `Value` | `collaboration_mode_list_core` |
| `listMcpServerStatus(workspaceId, cursor, limit)` | `list_mcp_server_status` | `list_mcp_server_status` | `mcpServerStatus/list` | `workspaceId`, optional `cursor`, `limit` | Raw app-server response `Value` | `list_mcp_server_status_core` |
| `getAccountRateLimits(workspaceId)` | `account_rate_limits` | `account_rate_limits` | `account/rateLimits/read` | `workspaceId` | Raw app-server response `Value` | `account_rate_limits_core` |
| `getAccountInfo(workspaceId)` | `account_read` | `account_read` | `account/read` | `workspaceId` | Merged app-server/fallback account response | `account_read_core` |
| `runCodexLogin(workspaceId)` | `codex_login` | `codex_login` | `account/login/start` | `workspaceId`; core sends `{ type: "chatgpt" }` | `{ loginId, authUrl, raw }` | `codex_login_core` |
| `cancelCodexLogin(workspaceId)` | `codex_login_cancel` | `codex_login_cancel` | `account/login/cancel` when login ID exists | `workspaceId`; core uses stored login cancel state | `{ canceled, status?, raw? }` | `codex_login_cancel_core` |
| `getSkillsList(workspaceId)` | `skills_list` | `skills_list` | `skills/list` | `workspaceId`; core resolves `CODEX_HOME` | Raw app-server response `Value` | `skills_list_core` |
| `getAppsList(workspaceId, cursor, limit, threadId)` | `apps_list` | `apps_list` | `app/list` | `workspaceId`, optional `cursor`, `limit`, `threadId` | Raw app-server response `Value` | `apps_list_core` |

Commands that are part of the app wrapper but do not send app-server requests:

| UI API | Tauri command | Daemon JSON-RPC method | Backend behavior |
| --- | --- | --- | --- |
| `threadLiveSubscribe(workspaceId, threadId)` | `thread_live_subscribe` | `thread_live_subscribe` | Validates workspace/thread context; live events already arrive on `app-server-event`. |
| `threadLiveUnsubscribe(workspaceId, threadId)` | `thread_live_unsubscribe` | `thread_live_unsubscribe` | Validates workspace/thread context; no Codex app-server unsubscribe is sent. |
| `respondToServerRequest(workspaceId, requestId, decision)` | `respond_to_server_request` | `respond_to_server_request` | Sends JSON-RPC response `{ id: requestId, result: { decision } }` back to Codex. |
| `respondToUserInputRequest(workspaceId, requestId, answers)` | `respond_to_server_request` | `respond_to_server_request` | Sends JSON-RPC response `{ id: requestId, result: { answers } }` back to Codex. |

## Request/Response Flow

Direct request/response commands use app-server JSON-RPC IDs. The shared core
calls `WorkspaceSession::send_request_for_workspace(workspace_id, method,
params)`. The session assigns a numeric ID, writes:

```json
{ "id": 1, "method": "turn/start", "params": {} }
```

The pending request is stored in the session pending map until Codex returns a
message with the same `id` and a `result` or `error`. That response resolves the
original Tauri `invoke(...)` Promise.

Streaming notifications do not resolve the original Promise. They are emitted by
Codex as app-server methods without being matched to the pending request. The
session wraps them as:

```json
{
  "workspace_id": "workspace-id",
  "message": {
    "method": "turn/started",
    "params": {}
  }
}
```

Server request events are app-server messages with both `id` and `method`. They
are surfaced to the UI as `app-server-event` payloads and must be answered with
`respond_to_server_request`. The response is written back to Codex as:

```json
{ "id": 12, "result": { "decision": "accept" } }
```

or:

```json
{ "id": 13, "result": { "answers": {} } }
```

## Request/Response Event Inventory

| Event kind | Method examples | Has request ID | Frontend route | Response path |
| --- | --- | --- | --- | --- |
| Thread lifecycle notification | `thread/started`, `thread/status/changed`, `thread/name/updated`, `thread/closed`, `thread/archived`, `thread/unarchived` | No | `useAppServerEvents` thread handlers | No direct response |
| Turn lifecycle notification | `turn/started`, `turn/plan/updated`, `turn/diff/updated`, `turn/completed` | No | `useAppServerEvents` turn handlers | No direct response |
| Item lifecycle notification | `item/started`, `item/completed` | No | `useAppServerEvents` item handlers | No direct response |
| Agent text stream | `item/agentMessage/delta` | No | `onAgentMessageDelta` | No direct response |
| Reasoning stream | `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded` | No | reasoning handlers | No direct response |
| Command/file stream | `item/commandExecution/outputDelta`, `item/commandExecution/terminalInteraction`, `item/fileChange/outputDelta` | No | command/file item handlers | No direct response |
| Hook notification | `hook/started`, `hook/completed` | No | hook handlers | No direct response |
| Account notification | `account/updated`, `account/rateLimits/updated`, `account/login/completed` | No | account handlers | No direct response |
| App/skill synthetic or feature event | `app/list/updated`, `codex/event/skills_update_available`, `codex/connected`, `codex/backgroundThread` | No | feature-specific subscriptions or app event router | No direct response |
| Approval server request | Methods ending in `requestApproval`, including `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval` | Yes | `onApprovalRequest` | `respond_to_server_request` with `{ decision }` |
| User-input server request | `item/tool/requestUserInput` | Yes | `onRequestUserInput` | `respond_to_server_request` with `{ answers }` |

## Lifecycle Flows

Start thread:

```text
startThread(workspaceId)
-> invoke("start_thread", { workspaceId })
-> local codex adapter or remote daemon method "start_thread"
-> start_thread_core(...)
-> app-server "thread/start" with cwd and approvalPolicy
-> immediate app-server response resolves invoke
-> follow-up "thread/started" event updates thread state
```

Send message:

```text
sendUserMessage(workspaceId, threadId, text, options)
-> normalize images for local or remote runtime
-> invoke("send_user_message", payload)
-> local codex adapter or remote daemon method "send_user_message"
-> send_user_message_core(...)
-> app-server "turn/start"
-> immediate app-server response resolves invoke
-> "turn/started", item deltas, tool events, token usage, and "turn/completed"
-> event handlers update thread item state and visible messages
```

Approval request:

```text
Codex emits method ending in "requestApproval" with an app-server request id
-> WorkspaceSession emits "app-server-event"
-> useAppServerEvents detects requestApproval + id
-> approval UI is shown from thread approval handlers
-> respondToServerRequest(workspaceId, requestId, "accept" | "decline")
-> invoke("respond_to_server_request", ...)
-> WorkspaceSession::send_response(requestId, { decision })
-> Codex continues or rejects the pending tool action
```

User input request:

```text
Codex emits "item/tool/requestUserInput" with an app-server request id
-> WorkspaceSession emits "app-server-event"
-> useAppServerEvents parses questions and calls onRequestUserInput
-> user input UI collects answers
-> respondToUserInputRequest(workspaceId, requestId, answers)
-> invoke("respond_to_server_request", ...)
-> WorkspaceSession::send_response(requestId, { answers })
```

Thread list/read:

```text
listThreads(...) or readThread(...)
-> invoke("list_threads" | "read_thread", ...)
-> shared core sends "thread/list" or "thread/read"
-> immediate response resolves invoke
-> caller reconciles returned thread summaries or thread contents into frontend state
```

## Per-Method Full Record: `turn/start`

Purpose:
- Starts a new user turn in an existing Codex thread.

UI caller:
- `sendUserMessage(...)` in `src/services/tauri.ts`.

Tauri command:
- `send_user_message`.

Daemon JSON-RPC method:
- `send_user_message`.

Codex app-server method:
- `turn/start`.

UI request payload:

```ts
{
  workspaceId: string;
  threadId: string;
  text: string;
  model: string | null;
  effort: string | null;
  accessMode: "read-only" | "current" | "full-access" | null;
  images: string[] | null;
  serviceTier?: "fast" | "flex" | null;
  collaborationMode?: Record<string, unknown>;
  appMentions?: AppMention[];
}
```

Core app-server params:

```ts
{
  threadId: string;
  input: Array<
    | { type: "text"; text: string }
    | { type: "image"; url: string }
    | { type: "localImage"; path: string }
    | { type: "mention"; name: string; path: string }
  >;
  cwd: string;
  approvalPolicy: "on-request" | "never";
  sandboxPolicy:
    | { type: "readOnly" }
    | { type: "workspaceWrite"; writableRoots: string[]; networkAccess: boolean }
    | { type: "dangerFullAccess" };
  model: string | null;
  effort: string | null;
  serviceTier?: "fast" | "flex" | null;
  collaborationMode?: unknown;
}
```

Immediate response:
- The app-server JSON-RPC response for `turn/start` resolves the original
  `sendUserMessage(...)` Promise.
- The meaningful assistant output usually arrives later through app-server
  events, not in this immediate response.

Follow-up events:
- `turn/started`
- `item/started`
- `item/agentMessage/delta`
- `item/reasoning/textDelta`
- `item/reasoning/summaryTextDelta`
- `item/reasoning/summaryPartAdded`
- `item/plan/delta`
- `item/commandExecution/outputDelta`
- `item/commandExecution/terminalInteraction`
- `item/fileChange/outputDelta`
- approval request methods ending in `requestApproval`
- `item/tool/requestUserInput`
- `item/completed`
- `turn/plan/updated`
- `turn/diff/updated`
- `thread/tokenUsage/updated`
- `turn/completed`

Routing:
- Local mode: `send_user_message` -> `src-tauri/src/codex/mod.rs` ->
  `send_user_message_core`.
- Remote mode: `send_user_message` -> `remote_backend::call_remote(...)` ->
  daemon JSON-RPC `send_user_message` -> shared state ->
  `send_user_message_core`.
- App-server event return path: `WorkspaceSession` -> `AppServerEvent` ->
  `"app-server-event"` -> `subscribeAppServerEvents` ->
  `useAppServerEvents`.

State updates:
- Turn state is updated by turn event handlers.
- Item and streaming text state is updated by item event handlers.
- Token usage is updated from `thread/tokenUsage/updated`.
- Approval and user-input requests are stored by their feature handlers until
  answered.

UI exposure:
- Assistant text, reasoning, command output, file-change output, plans, and
  completed items render through the thread/message UI.
- Approval and user-input requests surface as interactive UI prompts.
- Turn status and token usage surface through thread state and related shell UI.

## State And Exposure Map

| Data | Source | Update location | Surfaced/exposed through |
| --- | --- | --- | --- |
| Thread summaries and hierarchy | `thread/list`, `thread/started`, thread lifecycle events | thread reducer and thread reconciliation hooks | thread list/sidebar and active thread selection |
| Thread contents | `thread/read`, `item/started`, `item/completed`, item delta events | thread item event handlers and reducers | messages view |
| Active turn state | `turn/started`, `turn/completed`, `error` | turn event handlers | composer/send state, thread status, active turn UI |
| Assistant text stream | `item/agentMessage/delta`, `item/completed` | item event handlers | message transcript |
| Reasoning and plan stream | reasoning and plan item events | item event handlers | reasoning/plan message UI |
| Command and file output | command/file delta events, terminal interaction events | item event handlers | command/file output message UI |
| Approval prompts | approval server request methods | approval handlers | approval prompt UI; answer through `respond_to_server_request` |
| User-input prompts | `item/tool/requestUserInput` | user-input handlers | user-input prompt UI; answer through `respond_to_server_request` |
| Account state | `account/read`, `account/updated`, `account/login/completed`, `account/rateLimits/updated` | account handlers/settings state | account and rate-limit UI |
| App and skill updates | `app/list`, `skills/list`, `app/list/updated`, `codex/event/skills_update_available` | app/skill feature hooks | app mention and skills UI |

## Routing Rules

- Frontend code should call backend commands only through `src/services/tauri.ts`.
- Backend command behavior shared by app and daemon belongs in
  `src-tauri/src/shared/codex_core.rs`.
- `src-tauri/src/codex/mod.rs` should remain an adapter that chooses local or
  remote execution.
- Daemon JSON-RPC methods should preserve the same method names and payload
  shapes as the app adapter.
- App-server notifications and server requests should be added first to
  `src/utils/appServerEvents.ts`, then routed in
  `src/features/app/hooks/useAppServerEvents.ts`, then applied by feature
  handlers/reducers.

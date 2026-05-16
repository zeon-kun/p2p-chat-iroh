# Chat Backend — Frontend API Reference

This document describes the complete interface between the Rust backend and the
frontend. The only transport the frontend touches is **WebSocket**. There is no
REST API, no HTTP polling.

---

## Starting the backend

The backend is a single binary with two subcommands. Run them in separate
terminals (or processes) — one per chat participant.

### Peer A — open a room

```sh
cargo run --bin chat -- open --room <name> --ws-port <port>
```

| Flag | Default | Description |
|------|---------|-------------|
| `--room` | `default` | Room name. Determines the gossip topic (blake3 of the name). |
| `--ws-port` | `9001` | Local port the WS bridge listens on. |

On startup it prints a **ticket** string to stdout:

```
=================================================
CHAT room: myroom
Local peer: <peer-id>

TICKET (give this to joiners):
  <base32-ticket-string>
WebSocket: ws://127.0.0.1:9001
=================================================
```

### Peer B — join a room

```sh
cargo run --bin chat -- join <ticket> --room <name> --ws-port <port>
```

| Argument/Flag | Default | Description |
|---------------|---------|-------------|
| `ticket` | — | The base32 ticket string printed by `open`. Required. |
| `--room` | `default` | Must match the opener's `--room`. |
| `--ws-port` | `9002` | Local port the WS bridge listens on. |

> **Note:** Peer A blocks at "waiting for peers to join" until Peer B connects
> to gossip. The WS bridge is available immediately after startup — connect the
> frontend before or after peers join.

---

## WebSocket API

### Connection URL

```
ws://127.0.0.1:<ws-port>
```

The backend only binds on loopback. The frontend must run on the same machine
(or use port-forwarding). Multiple frontend clients can connect to the same
backend instance simultaneously.

### Protocol

Plain WebSocket (no subprotocol negotiation). All application frames are **text**
frames containing UTF-8 JSON.

---

## Message schema

### `ChatMessage` (server → client, and optionally client → server)

Every message delivered to the frontend is a JSON text frame matching this
shape:

```ts
interface ChatMessage {
  from: string;   // short peer-id of the sender (8–12 hex chars)
  body: string;   // message text
  ts:   number;   // send timestamp, Unix milliseconds (u64 fits in JS number up to year 2255)
  nonce: number[]; // 16-element array of u8, for deduplication — treat as opaque
}
```

**Example frame payload:**

```json
{
  "from": "a3f2c1b0",
  "body": "hello world",
  "ts": 1715800000000,
  "nonce": [12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12]
}
```

---

## Connection lifecycle

```
Client                              Server
  |                                   |
  |--- WebSocket handshake ---------->|
  |                                   |
  |<-- ChatMessage (history[0]) ------|  \
  |<-- ChatMessage (history[1]) ------|   } snapshot replay (0–500 messages)
  |<-- ChatMessage (history[N]) ------|  /
  |                                   |
  |<-- ChatMessage (live) ------------|  }
  |<-- ChatMessage (live) ------------|  } live broadcast as peers send
  |        ...                        |  }
  |                                   |
  |--- send message ----------------->|  (see "Sending messages" below)
  |                                   |
  |--- Close frame ------------------>|  client-initiated disconnect
  |<-- Close frame -------------------|  server echoes to complete handshake
  |                                   |
  OR
  |                                   |
  |<-- Close(1001, "server          --|  server shutdown (Ctrl+C)
  |         shutting down")           |
```

### On connect

The server immediately replays the in-memory history (up to the last **500**
messages) as individual `ChatMessage` frames, oldest first. History replay
happens before any live messages are forwarded, so there is no gap or race.

### Live messages

After history replay, every new message received over gossip is pushed as a
`ChatMessage` frame in real time.

### Keepalive

The server sends a WebSocket `Ping` frame every **30 seconds**. The browser
WebSocket API responds automatically with `Pong` — no application-level
handling needed. This exists to detect and close half-open TCP connections.

### Server shutdown

On `Ctrl+C` the server sends a `Close(1001 Going Away, "server shutting down")`
frame to every connected client. The connection then closes cleanly. The
frontend should treat this as a signal to show a "disconnected" state and
optionally attempt reconnect.

### Client disconnect

Send a WebSocket `Close` frame (the browser does this automatically when you
call `ws.close()`). The server echoes a `Close` frame and tears down the
connection. No application message is required.

---

## Sending messages

Send a **text frame** with one of two formats:

### Option A — plain text (simplest)

```
hello world
```

The backend wraps this string into a `ChatMessage` with `from` set to the
local peer-id and `ts` set to the current time, then broadcasts it to all
gossip peers and echoes it back to all connected WS clients (including the
sender).

### Option B — full JSON (if you need client-side control)

```json
{ "from": "...", "body": "hello world", "ts": 0, "nonce": [...] }
```

The backend extracts `body` and treats it identically to Option A. The `from`,
`ts`, and `nonce` fields you send are **ignored** — the backend always
overwrites them with the local peer-id, current timestamp, and a fresh nonce.
Use Option B only if your code already produces `ChatMessage` objects; otherwise
use Option A.

---

## TypeScript reference

```ts
/** All frames the backend sends are this type. */
export interface ChatMessage {
  from:  string;
  body:  string;
  ts:    number;
  nonce: number[];
}

/** Minimal client wrapper. */
export class ChatSocket {
  private ws: WebSocket;

  constructor(
    port: number,
    private onMessage: (msg: ChatMessage) => void,
    private onClose: (clean: boolean) => void,
  ) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    this.ws.onclose = (e) => this.onClose(e.wasClean);
  }

  send(body: string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(body);           // plain-text Option A
    }
  }

  close(): void {
    this.ws.close();
  }
}
```

---

## Known MVP constraints

| Constraint | Detail |
|------------|--------|
| **History is in-memory** | Capped at 500 messages. Lost on backend restart. Reconnecting clients receive whatever is still in memory. |
| **Loopback only** | `ws://127.0.0.1:<port>`. The backend does not bind on `0.0.0.0`. |
| **One relay** | Hardcoded to `https://relay.jeong.cloud:8843`. No fallback. |
| **No auth** | Any WS client on the same machine can connect and send messages. |
| **No connection limit** | No backpressure on the number of simultaneous WS clients. |
| **`open` blocks until first peer** | The `open` peer doesn't start gossip until Peer B calls `join`. The WS bridge is ready immediately, but messages sent before Peer B joins are echoed locally only. |

---

## Logs

Structured logs are written to `logs/chat-<timestamp>.log` (JSON, one line per
event). Useful fields for debugging:

| Target | When |
|--------|------|
| `relay_test::ws` | WS client connect / disconnect / errors |
| `relay_test::chat` | Gossip messages received / sent, peer up/down |

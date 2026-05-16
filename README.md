# iroh relay-test

A peer-to-peer chat application built on [iroh](https://iroh.computer). Two peers connect directly (or via a relay fallback) using QUIC, exchange messages over `iroh-gossip`, and surface everything through a browser UI backed by a Rust WebSocket bridge.

No central message broker. The relay is only a connection helper — once peers find each other, traffic flows peer-to-peer.

---

## Prerequisites

### Rust

Install `rustup` (the Rust toolchain manager):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Follow the on-screen prompts, then reload your shell:

```bash
source "$HOME/.cargo/env"
```

Verify:

```bash
rustc --version   # e.g. rustc 1.78.0
cargo --version   # e.g. cargo 1.78.0
```

The project uses the **2021 edition** — any stable toolchain from 1.75+ works.

### Node.js

The web frontend and simulation harness both require Node.js **≥ 22.12.0**.

```bash
node --version   # e.g. v22.12.0
npm --version
```

---

## Quick Start

### 1. Build the backend

```bash
cargo build --release
```

Binaries land in `target/release/`. During development you can skip `--release` and use `cargo run` directly.

### 2. Start the web frontend

```bash
cd web
npm install      # first time only
npm run dev      # Astro dev server → http://localhost:4321
```

### 3. Start Peer A (host)

In a new terminal from the repo root:

```bash
cargo run --bin chat -- serve --ws-port 9001
```

The backend waits for a command from the UI. Open `http://localhost:4321` in a browser, pick a room name, and click **Open Room**. The UI sends `{"cmd":"open","room":"<name>"}` over WebSocket and the backend prints a ticket.

### 4. Start Peer B (joiner)

In another terminal:

```bash
cargo run --bin chat -- serve --ws-port 9002
```

Open a second browser tab at `http://localhost:4321`, click **Join Room**, and paste the ticket from Peer A.

### 5. (Optional) Room registry

The registry lets the landing page list open rooms automatically so joiners don't have to paste tickets manually.

```bash
cargo run --bin chat -- registry --port 9000
```

Start it before starting any `serve` instances. Both `serve` processes connect to it on port 9000 by default.

---

## Simulation Tests

The `simulation/` directory contains Playwright tests that drive two headless browser sessions against two `serve` processes automatically.

```bash
cd simulation
npm install                 # first time only
npx playwright install      # download browser binaries (first time only)
npm test                    # run all scenarios headlessly
npm run test:ui             # Playwright UI mode (interactive)
npm run test:headed         # headed (visible browser windows)
```

Tests target `http://localhost:4321/simulation` — make sure the Astro dev server is running first.

---

## Project Tree

```
relay-test/
├── Cargo.toml                  # workspace manifest + dependencies
├── Cargo.lock
│
├── src/
│   ├── lib.rs                  # crate root — re-exports all modules
│   ├── bin/
│   │   └── chat.rs             # main binary: CLI entry (open / join / serve / registry)
│   ├── chat.rs                 # ChatHub (shared state) + run_gossip (send/recv loop)
│   ├── protocol.rs             # wire types: GossipFrame, ChatTicket, NetworkEvent, RoomCommand
│   ├── ws_bridge.rs            # WebSocket server — bridges browser ↔ chat hub
│   ├── registry.rs             # optional room-listing rendezvous server
│   ├── logging.rs              # tracing setup (file + stderr) + event broadcast channel
│   ├── telemetry.rs            # iroh endpoint telemetry helpers
│   └── tracing_tasks.rs        # background tasks: net_report logger, remote-info logger
│
├── web/                        # Astro + React frontend
│   ├── astro.config.mjs
│   ├── package.json
│   └── src/
│       ├── pages/
│       │   ├── index.astro     # landing page (room directory + open/join form)
│       │   ├── room.astro      # active chat room page
│       │   └── simulation.astro# side-by-side simulation view
│       ├── components/
│       │   ├── Landing.tsx     # landing page shell
│       │   ├── ChatRoom.tsx    # chat room shell
│       │   ├── ConnectForm.tsx # open/join form
│       │   ├── MessageList.tsx # scrolling message feed
│       │   ├── MessageInput.tsx# send box
│       │   ├── NetworkTrace.tsx# live network event panel
│       │   ├── TicketBanner.tsx# displays + copies the ticket string
│       │   ├── RoomDirectory.tsx# live list of open rooms from registry
│       │   ├── PeerModal.tsx   # peer info overlay
│       │   ├── SimulationLayout.tsx  # two-panel sim view
│       │   ├── SimulationPeer.tsx    # single peer panel inside simulation
│       │   ├── SimulationDrawer.tsx  # scenario picker drawer
│       │   └── ConnectingOverlay.tsx # connection-in-progress overlay
│       └── lib/
│           ├── useChatSocket.ts       # WebSocket hook — parses all server frames
│           ├── useRoomDirectory.ts    # registry subscription hook
│           ├── useSimulation.ts       # simulation state machine
│           ├── simulationScenarios.ts # scenario definitions (Basic, Ping-Pong, Burst, Cross-Talk)
│           └── peerIdentity.ts        # derives display name + colour from peer id
│
├── simulation/                 # Playwright test harness
│   ├── playwright.config.ts
│   ├── package.json
│   ├── fixtures/
│   │   └── index.ts            # custom fixture: spawns two chat backends + Astro
│   ├── helpers/
│   │   └── sim-page.ts         # page-object helpers for the simulation UI
│   └── tests/
│       └── multi-peer.spec.ts  # scenario test suite
│
└── logs/                       # structured chat logs (auto-created at runtime)
```

---

## Flow

```
                        PEER A                                       PEER B
┌─────────────────────────────────────────┐     ┌─────────────────────────────────────────┐
│  Browser                                │     │  Browser                                │
│  ┌──────────────────────────────────┐   │     │  ┌──────────────────────────────────┐   │
│  │  ChatRoom UI (React)             │   │     │  │  ChatRoom UI (React)             │   │
│  │  - send box                      │   │     │  │  - message feed                  │   │
│  │  - network trace panel           │   │     │  │  - network trace panel           │   │
│  └──────────────────────────────────┘   │     │  └──────────────────────────────────┘   │
│          │ WebSocket (loopback)         │     │          │ WebSocket (loopback)         │
│  ┌───────▼──────────────────────────┐   │     │  ┌───────▼──────────────────────────┐   │
│  │  ws_bridge.rs                    │   │     │  │  ws_bridge.rs                    │   │
│  │  - replay history on connect     │   │     │  │  - replay history on connect     │   │
│  │  - fan-out live msgs + events    │   │     │  │  - fan-out live msgs + events    │   │
│  └──────────────────────────────────┘   │     │  └──────────────────────────────────┘   │
│          │ mpsc channel                 │     │          │ mpsc channel                 │
│  ┌───────▼──────────────────────────┐   │     │  ┌───────▼──────────────────────────┐   │
│  │  ChatHub (chat.rs)               │   │     │  │  ChatHub (chat.rs)               │   │
│  │  - history ring (500 msgs)       │   │     │  │  - dedup set (16-byte nonce)     │   │
│  │  - broadcast channel             │   │     │  │  - broadcast channel             │   │
│  └──────────────────────────────────┘   │     │  └──────────────────────────────────┘   │
│          │                             │     │          │                             │
│  ┌───────▼──────────────────────────┐   │     │  ┌───────▼──────────────────────────┐   │
│  │  run_gossip (chat.rs)            │   │     │  │  run_gossip (chat.rs)            │   │
│  │  - encode → GossipFrame::Chat    │   │     │  │  - decode GossipFrame            │   │
│  │  - broadcast over gossip topic   │   │     │  │  - dedup, push to hub            │   │
│  └──────────────────────────────────┘   │     │  └──────────────────────────────────┘   │
│          │                             │     │          │                             │
│  ┌───────▼──────────────────────────┐   │     │  ┌───────▼──────────────────────────┐   │
│  │  iroh-gossip (pub/sub overlay)   │   │     │  │  iroh-gossip (pub/sub overlay)   │   │
│  └──────────────────────────────────┘   │     │  └──────────────────────────────────┘   │
│          │                             │     │          │                             │
│  ┌───────▼──────────────────────────┐   │     │  ┌───────▼──────────────────────────┐   │
│  │  iroh::Endpoint (QUIC)           │   │     │  │  iroh::Endpoint (QUIC)           │   │
│  └──────────────────────────────────┘   │     │  └──────────────────────────────────┘   │
└──────────────────────┬──────────────────┘     └──────────────────────┬──────────────────┘
                       │                                                │
            direct QUIC (if NAT permits) ◄────────────────────────────►│
                       │                                                │
                       └───────────────┐      ┌─────────────────────────┘
                                       ▼      ▼
                              ┌──────────────────────┐
                              │  iroh Relay server   │
                              │  relay.jeong.cloud   │
                              │  :8843 (QUIC/HTTPS)  │
                              └──────────────────────┘
```

### Room discovery (serve mode)

```
chat serve (A) ──announce──► registry :9000 ◄──subscribe── Landing UI
                                   │
                              live room list
                                   │
                              Landing UI ──paste ticket──► chat serve (B)
```

---

## Under the Hood

### iroh stack

The backend is built on three iroh primitives:

**`iroh::Endpoint`** is the QUIC transport layer. On startup each peer generates an `ed25519` keypair; the public key becomes its `NodeId`. The endpoint tries a direct QUIC connection first. If NAT blocks it, it falls back to the relay at `relay.jeong.cloud:8843`.

**`iroh::Router`** dispatches incoming QUIC streams by ALPN protocol tag. The gossip ALPN (`iroh_gossip::proto::GOSSIP_ALPN`) is registered so all incoming gossip connections are handled automatically without manual routing.

**`iroh-gossip`** is a pub/sub overlay on top of QUIC. Each chat room maps to a `TopicId` derived as `blake3(room_name)` — no room registry needed for the gossip layer itself. Messages broadcast on a topic reach all current subscribers.

### Ticket-based discovery

When a host opens a room in `serve` mode the backend serialises `{ topic: TopicId, peers: [EndpointAddr] }` with [postcard](https://github.com/jamesmunns/postcard), base32-encodes it, and sends it to the frontend as a `NetworkEvent::RoomReady`. The joiner pastes this ticket string; the backend deserialises it, loads the host's addresses into its local `MemoryLookup`, and calls `gossip.subscribe(topic, bootstrap_peers)`. No DNS, no phone-home.

### Wire protocol

All gossip messages are wrapped in a `GossipFrame` enum:

- `GossipFrame::Chat(ChatMessage)` — a user message with `from`, `body`, `ts` (unix ms), and a random 16-byte `nonce`.
- `GossipFrame::RoomClosed` — sent by the host when it leaves so remote peers get a prompt signal.

Frames are JSON-serialised (tagged by the `frame` field). The nonce is stored in a `HashSet<[u8;16]>` per-receiver for deduplication — gossip may re-deliver frames, especially over the relay.

### WebSocket bridge

`ws_bridge.rs` accepts local WebSocket connections (one per browser tab). On connect it:

1. Sends the stored `welcome` event (`RoomReady` or `RoomJoined`) so the UI has room context.
2. Replays sorted history (by `ts`, then `nonce` for determinism across clock skew).
3. Sends a `HistoryComplete` sentinel so the frontend knows where history ends and live messages begin.
4. Enters a `select!` loop fanning out live `ChatMessage` and `NetworkEvent` broadcasts from the hub and fanning in plain-text sends from the browser.

In `serve` mode the bridge also accepts `RoomCommand` JSON from the UI (`open`, `join`, `leave`, `shutdown`) on the same connection — no separate control channel needed.

### ChatHub

`ChatHub` is an `Arc`-wrapped shared state struct:

- `history: Arc<Mutex<Vec<ChatMessage>>>` — capped at 500 entries, replayed to late-joining WS clients.
- `tx: broadcast::Sender<ChatMessage>` — live fan-out to all connected WS clients.
- `event_tx: broadcast::Sender<NetworkEvent>` — network telemetry fan-out (peer up/down, path selection, STUN RTTs, etc.).
- `outbound: Arc<Mutex<Option<mpsc::Sender<String>>>>` — the current room's inbound channel; `None` between rooms so stale sends are silently dropped.

`start_room()` resets history and creates a fresh `outbound` channel. `end_room()` drops it.

### Serve mode lifecycle

```
idle ──(open/join cmd)──► room active ──(leave/shutdown/ctrl-c)──► idle
                              │
                   run_gossip drives send+recv
                   ws_bridge handles all WS clients
```

The outer `'peer` loop in `chat.rs` keeps the iroh endpoint and gossip instance alive across room sessions. Each room gets its own `gossip.subscribe(topic, bootstrap)` call and a fresh `ChatHub` outbound channel.

### Simulation harness

The Playwright fixture in `simulation/fixtures/index.ts` spawns two `cargo run --bin chat -- serve` processes on ports 9001 and 9002, waits for them to be ready, and navigates Chromium to `/simulation`. The simulation page (`SimulationLayout`) renders two side-by-side `SimulationPeer` panels, each connected to one backend. `useSimulation.ts` implements a state machine (`idle → waiting-a → waiting-b → ready → running → done`) that drives the scenario steps: Peer A opens a room, Peer B joins via the ticket, then scripted messages are exchanged according to the chosen scenario.

**Scenarios:**

| Scenario | What it verifies |
|---|---|
| Basic Chat | A → B single message, B replies, A confirms — baseline delivery |
| Ping Pong | 8 alternating messages at 300 ms each — ordering under rate |
| Broadcast Burst | A sends 5 rapid messages, B confirms no duplicates — dedup at rate |
| Cross-Talk | A and B send simultaneously — concurrent handling + timestamp order |

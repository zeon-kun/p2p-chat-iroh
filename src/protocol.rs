use std::{fmt, str::FromStr};

use anyhow::{Context, Result};
use iroh::EndpointAddr;
use iroh_gossip::proto::TopicId;
use serde::{Deserialize, Serialize};

/// Wire message between chat peers over gossip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub from: String,
    pub body: String,
    pub ts: u64,
    pub nonce: [u8; 16],
}

impl ChatMessage {
    pub fn new(from: String, body: String) -> Self {
        Self {
            from,
            body,
            ts: unix_millis(),
            nonce: rand::random(),
        }
    }

    pub fn to_bytes(&self) -> Result<bytes::Bytes> {
        let v = serde_json::to_vec(self)?;
        Ok(bytes::Bytes::from(v))
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self> {
        serde_json::from_slice(b).context("decode ChatMessage")
    }
}

/// Gossip wire envelope: wraps either a chat message or a control signal.
/// Replaces bare `ChatMessage` serialization over gossip so control frames
/// can coexist on the same topic without a separate signalling channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "frame", rename_all = "snake_case")]
pub enum GossipFrame {
    Chat(ChatMessage),
    RoomClosed,
}

impl GossipFrame {
    pub fn to_bytes(&self) -> Result<bytes::Bytes> {
        let v = serde_json::to_vec(self)?;
        Ok(bytes::Bytes::from(v))
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self> {
        serde_json::from_slice(b).context("decode GossipFrame")
    }
}

pub fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Control command sent by the WS client to the backend (serve mode).
/// Discriminated by the `cmd` field.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum RoomCommand {
    /// Open a new room (host mode). Backend creates topic + ticket.
    Open { room: String },
    /// Join an existing room from a ticket string.
    Join { room: String, ticket: String },
    /// Host-initiated room teardown (only the room opener's UI sends this).
    Shutdown,
    /// Peer-initiated leave: exit the current room and return to idle.
    Leave,
}

/// Per-relay RTT measurement in a net_report update.
#[derive(Debug, Clone, Serialize)]
pub struct RelayLatency {
    pub probe: String,
    pub url:   String,
    pub ms:    u64,
}

/// Network-layer events sent over WS alongside ChatMessage frames.
/// Discriminated by the `type` field; ChatMessage has no `type` field.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NetworkEvent {
    /// A gossip neighbor came online.
    PeerUp   { peer: String, ts: u64 },
    /// A gossip neighbor went offline.
    PeerDown { peer: String, ts: u64 },
    /// Local peer sent a message into gossip (after echo to own hub).
    MsgSent  { from: String, ts: u64 },
    /// A message arrived from the gossip network (before dedup).
    MsgRecv  { from: String, ts: u64 },
    /// Periodic net_report update (STUN-driven RTT measurement).
    NetReport {
        preferred_relay: Option<String>,
        relay_latencies: Vec<RelayLatency>,
        udp_v4:          bool,
        udp_v6:          bool,
        captive_portal:  Option<bool>,
        ts:              u64,
    },
    /// Relay-server keepalive pong RTT.
    RelayPong { rtt_ms: f64, ts: u64 },
    /// STUN/direct-addr update scheduled (countdown in seconds).
    StunScheduled { in_secs: u64, ts: u64 },
    /// Relay connection established.
    RelayConnected { url: String, home: bool, ts: u64 },
    /// Active path selected (transport = "relay" | "direct").
    PathSelected { remote: String, transport: String, addr: String, rtt_ms: Option<f64>, ts: u64 },
    /// QUIC connection established with a remote peer.
    ConnEstablished { remote: String, side: String, alpn: String, ts: u64 },
    /// Room opened (host mode) — carries the ticket for sharing.
    RoomReady { ticket: String, peer_id: String, room: String, ts: u64 },
    /// Room joined successfully.
    RoomJoined { peer_id: String, room: String, ts: u64 },
    /// Current room was left (host shutdown or peer-initiated leave).
    /// Frontend should reset to idle state.
    RoomLeft { ts: u64 },
    /// Room was closed by the host (received over gossip by remote peers).
    /// Frontend should show a terminal "room closed" state, not idle pick.
    RoomClosed { ts: u64 },
    /// Sent by ws_bridge after replaying history, before entering the live stream.
    /// Frontend uses this to mark the history/live boundary instead of a timer.
    HistoryComplete { ts: u64 },
}

/// Ticket shared between chat peers. Carries the gossip topic and all known
/// peer addresses so the joiner can add them to the endpoint's address book.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatTicket {
    pub topic: TopicId,
    pub peers: Vec<EndpointAddr>,
}

impl ChatTicket {
    pub fn to_bytes(&self) -> Vec<u8> {
        postcard::to_stdvec(self).expect("postcard is infallible")
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self> {
        postcard::from_bytes(b).context("decode ChatTicket")
    }
}

impl fmt::Display for ChatTicket {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut s = data_encoding::BASE32_NOPAD.encode(&self.to_bytes());
        s.make_ascii_lowercase();
        write!(f, "{s}")
    }
}

impl FromStr for ChatTicket {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        let bytes = data_encoding::BASE32_NOPAD
            .decode(s.to_ascii_uppercase().as_bytes())
            .context("decode ticket base32")?;
        Self::from_bytes(&bytes)
    }
}

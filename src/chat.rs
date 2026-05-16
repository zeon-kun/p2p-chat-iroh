use std::sync::{Arc, Mutex};

use anyhow::Result;
use futures_util::TryStreamExt;
use iroh_gossip::api::{Event, GossipReceiver, GossipSender};
use tokio::sync::{broadcast, mpsc, watch};
use tracing::{info, warn};

use crate::{
    protocol::{unix_millis, ChatMessage, NetworkEvent},
    tracing_tasks::PeerEvent,
};

const MAX_HISTORY: usize = 500;

/// Shared state for a chat session: history replayed to new WS clients,
/// and broadcast channels to fan out messages and network events.
#[derive(Clone)]
pub struct ChatHub {
    pub history: Arc<Mutex<Vec<ChatMessage>>>,
    pub tx: broadcast::Sender<ChatMessage>,
    /// Network-layer events (peer up/down, send/recv, telemetry) forwarded to WS clients.
    pub event_tx: broadcast::Sender<NetworkEvent>,
    /// Sends raw message body strings from WS clients to the gossip sender task.
    pub outbound_tx: mpsc::Sender<String>,
}

impl ChatHub {
    pub fn new(
        outbound_tx: mpsc::Sender<String>,
        event_tx: broadcast::Sender<NetworkEvent>,
    ) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            history: Arc::new(Mutex::new(Vec::new())),
            tx,
            event_tx,
            outbound_tx,
        }
    }

    fn push(&self, msg: ChatMessage) {
        let mut h = self.history.lock().unwrap();
        h.push(msg.clone());
        if h.len() > MAX_HISTORY {
            let excess = h.len() - MAX_HISTORY;
            h.drain(..excess);
        }
        drop(h);
        let _ = self.tx.send(msg);
    }

    pub fn snapshot(&self) -> Vec<ChatMessage> {
        self.history.lock().unwrap().clone()
    }
}

/// Drive the gossip topic: fan in from WS via `outbound_rx` → broadcast,
/// fan out from gossip receiver → hub. Forwards NeighborUp/Down to the
/// remote-info logger via `neighbor_tx`.
/// Returns when gossip tasks end naturally or `shutdown_rx` signals true.
pub async fn run_gossip(
    local_id: String,
    sender: GossipSender,
    receiver: GossipReceiver,
    hub: ChatHub,
    mut outbound_rx: mpsc::Receiver<String>,
    neighbor_tx: mpsc::Sender<PeerEvent>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<()> {
    // receiver task: gossip events → hub
    let hub_recv = hub.clone();
    let neighbor_tx_recv = neighbor_tx.clone();
    let mut recv_handle = tokio::spawn(async move {
        recv_loop(receiver, hub_recv, neighbor_tx_recv).await
    });

    // sender task: outbound messages from WS → gossip broadcast
    let mut send_handle = tokio::spawn(async move {
        while let Some(body) = outbound_rx.recv().await {
            let msg = ChatMessage::new(local_id.clone(), body);
            // echo to local hub first (so sender's own WS sees it)
            hub.push(msg.clone());
            let _ = hub.event_tx.send(NetworkEvent::MsgSent {
                from: msg.from.clone(),
                ts: msg.ts,
            });
            match msg.to_bytes() {
                Ok(bytes) => {
                    if let Err(e) = sender.broadcast(bytes).await {
                        warn!(target: "relay_test::chat", "broadcast error: {e}");
                    }
                }
                Err(e) => warn!(target: "relay_test::chat", "encode error: {e}"),
            }
        }
    });

    loop {
        tokio::select! {
            biased;
            result = shutdown_rx.changed() => {
                match result {
                    Ok(()) if *shutdown_rx.borrow() => break,
                    Err(_) => break, // sender dropped — process exiting
                    _ => {}
                }
            }
            _ = &mut recv_handle => break,
            _ = &mut send_handle => break,
        }
    }

    recv_handle.abort();
    send_handle.abort();
    Ok(())
}

async fn recv_loop(
    mut receiver: GossipReceiver,
    hub: ChatHub,
    neighbor_tx: mpsc::Sender<PeerEvent>,
) -> Result<()> {
    // Track nonces to dedupe gossip at-least-once delivery
    let mut seen: std::collections::HashSet<[u8; 16]> = std::collections::HashSet::new();

    while let Some(event) = receiver.try_next().await? {
        match event {
            Event::Received(msg) => {
                match ChatMessage::from_bytes(&msg.content) {
                    Ok(chat_msg) => {
                        // Always emit MsgRecv (before dedup) so the trace shows all arrivals.
                        let _ = hub.event_tx.send(NetworkEvent::MsgRecv {
                            from: chat_msg.from.clone(),
                            ts: chat_msg.ts,
                        });
                        if seen.insert(chat_msg.nonce) {
                            info!(
                                target: "relay_test::chat",
                                from = %chat_msg.from,
                                body = %chat_msg.body,
                                ts = chat_msg.ts,
                                "received message"
                            );
                            hub.push(chat_msg);
                        }
                    }
                    Err(e) => warn!(target: "relay_test::chat", "decode error: {e}"),
                }
            }
            Event::NeighborUp(id) => {
                info!(target: "relay_test::chat", peer = %id, "neighbor joined");
                let _ = hub.event_tx.send(NetworkEvent::PeerUp {
                    peer: id.fmt_short().to_string(),
                    ts: unix_millis(),
                });
                let _ = neighbor_tx.send(PeerEvent::Up(id)).await;
            }
            Event::NeighborDown(id) => {
                info!(target: "relay_test::chat", peer = %id, "neighbor left");
                let _ = hub.event_tx.send(NetworkEvent::PeerDown {
                    peer: id.fmt_short().to_string(),
                    ts: unix_millis(),
                });
                let _ = neighbor_tx.send(PeerEvent::Down(id)).await;
            }
            Event::Lagged => {
                warn!(target: "relay_test::chat", "gossip receiver lagged — some messages may have been dropped");
            }
        }
    }
    Ok(())
}

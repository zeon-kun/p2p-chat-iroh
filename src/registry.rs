use std::{
    borrow::Cow,
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{broadcast, watch},
    task::JoinSet,
};
use tokio_tungstenite::{
    accept_async,
    tungstenite::{
        protocol::frame::{coding::CloseCode, CloseFrame},
        Message,
    },
};
use tracing::{info, warn};

/// A room that has been announced to the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomEntry {
    pub room:      String,
    pub ticket:    String,
    pub peer_id:   String,
    pub opened_at: u64,
}

/// First message each client sends to identify its role.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum RegistryMsg {
    /// A room-hosting `chat serve` process advertising its room.
    Announce {
        room:      String,
        ticket:    String,
        peer_id:   String,
        opened_at: u64,
    },
    /// The index page / landing UI subscribing to the live room list.
    Subscribe,
}

type RoomMap = Arc<Mutex<HashMap<u64, RoomEntry>>>;

/// Run the room registry WebSocket server.
/// Announcers hold a connection (liveness = room alive); on disconnect the room is pruned.
/// Subscribers receive the current snapshot immediately and every update thereafter.
pub async fn run_registry(port: u16, mut shutdown_rx: watch::Receiver<bool>) -> Result<()> {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse()?;
    let listener = TcpListener::bind(addr).await?;
    info!(target: "relay_test::registry", %addr, "room registry listening");

    let rooms: RoomMap = Arc::new(Mutex::new(HashMap::new()));
    let (list_tx, _) = broadcast::channel::<Vec<RoomEntry>>(32);
    let mut clients: JoinSet<()> = JoinSet::new();
    let mut next_id: u64 = 0;

    loop {
        tokio::select! {
            accept = listener.accept() => {
                let (stream, peer_addr) = accept?;
                let conn_id = next_id;
                next_id += 1;
                let rooms    = rooms.clone();
                let list_tx  = list_tx.clone();
                let sd       = shutdown_rx.clone();
                clients.spawn(async move {
                    if let Err(e) = handle_client(stream, peer_addr, conn_id, rooms, list_tx, sd).await {
                        warn!(target: "relay_test::registry", %peer_addr, "client error: {e}");
                    }
                });
            }
            result = shutdown_rx.changed() => {
                match result {
                    Ok(()) if *shutdown_rx.borrow() => break,
                    Err(_) => break,
                    _ => {}
                }
            }
            Some(_) = clients.join_next() => {}
        }
    }

    let _ = tokio::time::timeout(Duration::from_secs(3), async {
        while clients.join_next().await.is_some() {}
    })
    .await;

    Ok(())
}

async fn handle_client(
    stream: TcpStream,
    peer_addr: SocketAddr,
    conn_id: u64,
    rooms: RoomMap,
    list_tx: broadcast::Sender<Vec<RoomEntry>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<()> {
    let ws = accept_async(stream).await?;
    let (mut ws_tx, mut ws_rx) = ws.split();

    // Read the first text message to determine role (respond to pings while waiting).
    let first_text = loop {
        match ws_rx.next().await {
            Some(Ok(Message::Text(t))) => break t,
            Some(Ok(Message::Ping(p))) => { let _ = ws_tx.send(Message::Pong(p)).await; }
            Some(Ok(_)) => {}
            Some(Err(e)) => return Err(e.into()),
            None => return Ok(()),
        }
    };

    let msg: RegistryMsg = match serde_json::from_str(&first_text) {
        Ok(m) => m,
        Err(e) => {
            warn!(target: "relay_test::registry", %peer_addr, "unrecognised first message: {e}");
            return Ok(());
        }
    };

    match msg {
        RegistryMsg::Announce { room, ticket, peer_id, opened_at } => {
            info!(target: "relay_test::registry", %room, %peer_addr, "room announced");

            let entry = RoomEntry { room, ticket, peer_id, opened_at };
            {
                let mut r = rooms.lock().unwrap();
                r.insert(conn_id, entry);
                let snap: Vec<RoomEntry> = r.values().cloned().collect();
                let _ = list_tx.send(snap);
            }

            // Keep connection alive — this is the liveness signal for the room.
            loop {
                tokio::select! {
                    result = shutdown_rx.changed() => {
                        match result {
                            Ok(()) if *shutdown_rx.borrow() => break,
                            Err(_) => break,
                            _ => {}
                        }
                    }
                    msg = ws_rx.next() => {
                        match msg {
                            Some(Ok(Message::Ping(p))) => { let _ = ws_tx.send(Message::Pong(p)).await; }
                            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                            _ => {}
                        }
                    }
                }
            }

            // Connection closed (room shutdown or process exit) — prune and broadcast.
            {
                let mut r = rooms.lock().unwrap();
                r.remove(&conn_id);
                let snap: Vec<RoomEntry> = r.values().cloned().collect();
                let _ = list_tx.send(snap);
            }
            info!(target: "relay_test::registry", %peer_addr, "room deregistered");
        }

        RegistryMsg::Subscribe => {
            info!(target: "relay_test::registry", %peer_addr, "subscriber connected");
            let mut list_rx = list_tx.subscribe();

            // Send current snapshot immediately.
            let initial: Vec<RoomEntry> = rooms.lock().unwrap().values().cloned().collect();
            ws_tx.send(Message::Text(serde_json::to_string(&initial)?)).await?;

            loop {
                tokio::select! {
                    result = shutdown_rx.changed() => {
                        match result {
                            Ok(()) if *shutdown_rx.borrow() => {
                                let _ = ws_tx.send(Message::Close(Some(CloseFrame {
                                    code: CloseCode::Away,
                                    reason: Cow::Borrowed("registry shutting down"),
                                }))).await;
                                break;
                            }
                            Err(_) => break,
                            _ => {}
                        }
                    }
                    incoming = ws_rx.next() => {
                        match incoming {
                            Some(Ok(Message::Ping(p))) => { let _ = ws_tx.send(Message::Pong(p)).await; }
                            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                            _ => {}
                        }
                    }
                    update = list_rx.recv() => {
                        match update {
                            Ok(list) => {
                                let text = match serde_json::to_string(&list) {
                                    Ok(t) => t,
                                    Err(e) => { warn!(target: "relay_test::registry", "serialize: {e}"); continue; }
                                };
                                if ws_tx.send(Message::Text(text)).await.is_err() { break; }
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => {
                                // Missed updates — resend current snapshot.
                                let snap: Vec<RoomEntry> = rooms.lock().unwrap().values().cloned().collect();
                                let text = serde_json::to_string(&snap)?;
                                if ws_tx.send(Message::Text(text)).await.is_err() { break; }
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

use std::{borrow::Cow, net::SocketAddr, time::Duration};

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{broadcast, mpsc, watch},
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

use crate::{
    chat::ChatHub,
    protocol::{ChatMessage, NetworkEvent, RoomCommand, unix_millis},
};

/// Accepts WebSocket connections on `127.0.0.1:<port>`.
/// Each client receives the history snapshot on connect, then live messages,
/// and can send plain-text messages that are forwarded to the gossip topic.
/// In serve mode, `cmd_tx` receives the first `RoomCommand` from any client.
/// Stops accepting new connections when `shutdown_rx` fires and drains existing
/// clients (up to 3 s grace) so they each receive a clean WS Close frame.
pub async fn serve(
    port: u16,
    hub: ChatHub,
    cmd_tx: Option<mpsc::Sender<RoomCommand>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<()> {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse()?;
    let listener = TcpListener::bind(addr).await?;
    info!(target: "relay_test::ws", %addr, "WebSocket bridge listening");

    let mut clients: JoinSet<()> = JoinSet::new();

    loop {
        tokio::select! {
            accept = listener.accept() => {
                let (stream, peer_addr) = accept?;
                info!(target: "relay_test::ws", %peer_addr, "WebSocket client connected");
                let hub = hub.clone();
                let sd = shutdown_rx.clone();
                let cmd_tx = cmd_tx.clone();
                clients.spawn(async move {
                    if let Err(e) = handle_client(stream, peer_addr, hub, cmd_tx, sd).await {
                        warn!(target: "relay_test::ws", %peer_addr, "client error: {e}");
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
        }
    }

    // Give existing clients up to 3 s to send their Close frames and exit.
    let _ = tokio::time::timeout(Duration::from_secs(3), async {
        while clients.join_next().await.is_some() {}
    })
    .await;

    Ok(())
}

async fn handle_client(
    stream: TcpStream,
    peer_addr: SocketAddr,
    hub: ChatHub,
    cmd_tx: Option<mpsc::Sender<RoomCommand>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<()> {
    let ws = accept_async(stream).await?;
    let (mut ws_tx, mut ws_rx) = ws.split();

    // Subscribe to live messages and network events BEFORE snapshot to avoid a race.
    let mut live_rx  = hub.tx.subscribe();
    let mut event_rx = hub.event_tx.subscribe();

    // Replay in strict order: welcome → sorted history → HistoryComplete → live.
    // Welcome first so the frontend has room context before processing messages.
    // History is sorted by (ts, nonce) so cross-peer clock-skew is deterministic.
    // HistoryComplete replaces the 80 ms timer heuristic on the frontend.
    let welcome_ev = hub.welcome.lock().unwrap().clone();
    if let Some(ev) = welcome_ev {
        let text = serde_json::to_string(&ev)?;
        ws_tx.send(Message::Text(text)).await?;
    }

    let mut history = hub.snapshot();
    history.sort_by(|a, b| a.ts.cmp(&b.ts).then_with(|| a.nonce.cmp(&b.nonce)));
    for msg in history {
        let text = serde_json::to_string(&msg)?;
        ws_tx.send(Message::Text(text)).await?;
    }

    let sentinel = serde_json::to_string(&NetworkEvent::HistoryComplete { ts: unix_millis() })?;
    ws_tx.send(Message::Text(sentinel)).await?;

    // Server-initiated keepalive ping every 30 s to detect dead/half-open connections.
    let mut ping_interval = tokio::time::interval(Duration::from_secs(30));
    ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ping_interval.tick().await; // consume the immediate first tick

    'conn: loop {
        tokio::select! {
            // Shutdown signal: send a Close frame then exit.
            result = shutdown_rx.changed() => {
                match result {
                    Ok(()) if *shutdown_rx.borrow() => {
                        let _ = ws_tx.send(Message::Close(Some(CloseFrame {
                            code: CloseCode::Away,
                            reason: Cow::Borrowed("server shutting down"),
                        })))
                        .await;
                        break 'conn;
                    }
                    Err(_) => break 'conn,
                    _ => {}
                }
            }
            // Outbound: live chat message → WS client.
            live = live_rx.recv() => {
                match live {
                    Ok(msg) => {
                        let text = match serde_json::to_string(&msg) {
                            Ok(t) => t,
                            Err(e) => {
                                warn!(target: "relay_test::ws", "encode error: {e}");
                                continue 'conn;
                            }
                        };
                        if ws_tx.send(Message::Text(text)).await.is_err() {
                            break 'conn;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue 'conn,
                    Err(_) => break 'conn,
                }
            }
            // Outbound: network event → WS client.
            net = event_rx.recv() => {
                match net {
                    Ok(ev) => {
                        let text = match serde_json::to_string(&ev) {
                            Ok(t) => t,
                            Err(e) => {
                                warn!(target: "relay_test::ws", "encode net event error: {e}");
                                continue 'conn;
                            }
                        };
                        if ws_tx.send(Message::Text(text)).await.is_err() {
                            break 'conn;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue 'conn,
                    Err(_) => break 'conn,
                }
            }
            // Inbound: WS client → outbound channel (or room command in serve mode).
            incoming = ws_rx.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        // In serve mode, try to parse as a RoomCommand first.
                        if let Some(ref tx) = cmd_tx {
                            if let Ok(cmd) = serde_json::from_str::<RoomCommand>(&text) {
                                let _ = tx.send(cmd).await;
                                continue 'conn;
                            }
                        }
                        // Fall back: accept plain string body or full JSON ChatMessage.
                        let body = if let Ok(cm) = serde_json::from_str::<ChatMessage>(&text) {
                            cm.body
                        } else {
                            text
                        };
                        // Look up the current sender on each message; None = no room active (drop silently).
                        if let Some(tx) = hub.outbound_sender() {
                            let _ = tx.send(body).await;
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        let _ = ws_tx.send(Message::Pong(p)).await;
                    }
                    Some(Ok(Message::Close(_))) => {
                        // Echo the Close frame to complete the handshake.
                        let _ = ws_tx.send(Message::Close(None)).await;
                        break 'conn;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        warn!(target: "relay_test::ws", %peer_addr, "ws error: {e}");
                        break 'conn;
                    }
                    None => break 'conn,
                }
            }
            // Keepalive ping to detect half-open TCP connections.
            _ = ping_interval.tick() => {
                if ws_tx.send(Message::Ping(vec![])).await.is_err() {
                    break 'conn;
                }
            }
        }
    }

    info!(target: "relay_test::ws", %peer_addr, "WebSocket client disconnected");
    Ok(())
}

use std::{borrow::Cow, net::SocketAddr, time::Duration};

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
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

use crate::{
    chat::ChatHub,
    protocol::ChatMessage,
};

/// Accepts WebSocket connections on `127.0.0.1:<port>`.
/// Each client receives the history snapshot on connect, then live messages,
/// and can send plain-text messages that are forwarded to the gossip topic.
/// Stops accepting new connections when `shutdown_rx` fires and drains existing
/// clients (up to 3 s grace) so they each receive a clean WS Close frame.
pub async fn serve(port: u16, hub: ChatHub, mut shutdown_rx: watch::Receiver<bool>) -> Result<()> {
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
                clients.spawn(async move {
                    if let Err(e) = handle_client(stream, peer_addr, hub, sd).await {
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
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<()> {
    let ws = accept_async(stream).await?;
    let (mut ws_tx, mut ws_rx) = ws.split();

    // Subscribe to live messages and network events BEFORE snapshot to avoid a race.
    let mut live_rx  = hub.tx.subscribe();
    let mut event_rx = hub.event_tx.subscribe();

    // Replay history.
    for msg in hub.snapshot() {
        let text = serde_json::to_string(&msg)?;
        ws_tx.send(Message::Text(text)).await?;
    }

    let outbound_tx = hub.outbound_tx.clone();

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
            // Inbound: WS client → outbound channel.
            incoming = ws_rx.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        // Accept either a plain string body or a full JSON ChatMessage.
                        let body = if let Ok(cm) = serde_json::from_str::<ChatMessage>(&text) {
                            cm.body
                        } else {
                            text
                        };
                        if outbound_tx.send(body).await.is_err() {
                            break 'conn;
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

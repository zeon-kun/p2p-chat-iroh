use std::time::Duration;

use anyhow::Result;
use clap::{Parser, Subcommand};
use futures_util::{SinkExt, StreamExt};
use iroh::{
    RelayMode, RelayUrl,
    address_lookup::memory::MemoryLookup,
    endpoint::presets,
    protocol::Router,
    Endpoint,
};
use iroh_gossip::net::{Gossip, GOSSIP_ALPN};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

use iroh_gossip::api::{GossipReceiver, GossipSender};
use relay_test::{
    chat::{ChatHub, run_gossip},
    logging::init_logging,
    protocol::{ChatTicket, GossipFrame, NetworkEvent, RoomCommand, unix_millis},
    registry,
    tracing_tasks::{PeerEvent, spawn_net_report_logger, spawn_remote_info_logger},
    ws_bridge,
};

const RELAY_URL: &str    = "https://relay.jeong.cloud:8843";
const REGISTRY_PORT: u16 = 9000;

#[derive(Parser)]
#[command(name = "chat", about = "p2p chat over a custom relay")]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Open a chat room and print a ticket for others to join.
    Open {
        #[arg(long, default_value = "default")]
        room: String,
        #[arg(long, default_value = "9001")]
        ws_port: u16,
        /// Port of the room registry (default 9000; skipped if registry not running).
        #[arg(long, default_value_t = REGISTRY_PORT)]
        registry_port: u16,
    },
    /// Join a chat room from a ticket.
    Join {
        ticket: String,
        #[arg(long, default_value = "default")]
        room: String,
        #[arg(long, default_value = "9002")]
        ws_port: u16,
    },
    /// Start in serve mode: wait for a room command from the UI over WebSocket.
    Serve {
        #[arg(long, default_value = "9001")]
        ws_port: u16,
        /// Port of the room registry (default 9000; skipped if registry not running).
        #[arg(long, default_value_t = REGISTRY_PORT)]
        registry_port: u16,
    },
    /// Run the shared room registry (a WebSocket rendezvous server).
    Registry {
        #[arg(long, default_value_t = REGISTRY_PORT)]
        port: u16,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Registry runs without an iroh endpoint — handle it first.
    if let Command::Registry { port } = args.command {
        let (_guard, _) = init_logging("registry")?;
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        tokio::select! {
            r = registry::run_registry(port, shutdown_rx) => { r?; }
            _ = tokio::signal::ctrl_c() => {
                info!(target: "relay_test::registry", "ctrl-c — shutting down");
                let _ = shutdown_tx.send(true);
            }
        }
        return Ok(());
    }

    let (_guard, event_tx) = init_logging("chat")?;

    let relay_url: RelayUrl = RELAY_URL.parse()?;
    let memory_lookup = MemoryLookup::new();
    let crypto_provider = iroh_relay::tls::default_provider();

    let endpoint = Endpoint::builder(presets::Empty)
        .address_lookup(memory_lookup.clone())
        .relay_mode(RelayMode::Custom(relay_url.clone().into()))
        .crypto_provider(crypto_provider)
        .bind()
        .await?;

    let local_id = endpoint.id().fmt_short().to_string();
    info!(target: "relay_test::chat", peer_id = %endpoint.id(), "endpoint bound");

    spawn_net_report_logger(endpoint.clone(), event_tx.clone());

    match tokio::time::timeout(Duration::from_secs(10), endpoint.online()).await {
        Ok(()) => info!(target: "relay_test::chat", "endpoint online"),
        Err(_) => warn!(target: "relay_test::chat", "timed out waiting for relay — continuing anyway"),
    }

    let gossip = Gossip::builder().spawn(endpoint.clone());
    let router = Router::builder(endpoint.clone())
        .accept(GOSSIP_ALPN, gossip.clone())
        .spawn();

    let (neighbor_tx, neighbor_rx) = mpsc::channel::<PeerEvent>(32);
    let hub = ChatHub::new(event_tx);
    spawn_remote_info_logger(endpoint.clone(), neighbor_rx);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    match args.command {
        Command::Registry { .. } => unreachable!(),

        Command::Open { room, ws_port, registry_port } => {
            let topic      = room_to_topic(&room);
            let me         = endpoint.addr();
            let ticket     = ChatTicket { topic, peers: vec![me] };
            let outbound_rx = hub.start_room();

            println!("=================================================");
            println!("CHAT room: {room}");
            println!("Local peer: {}", endpoint.id());
            println!();
            println!("TICKET (give this to joiners):");
            println!("  {ticket}");
            println!("WebSocket: ws://127.0.0.1:{ws_port}");
            println!("=================================================");

            let hub_ws = hub.clone();
            let serve_handle = tokio::spawn({
                let sd = shutdown_rx.clone();
                async move { ws_bridge::serve(ws_port, hub_ws, None, sd).await }
            });

            // Non-blocking subscribe so the ticket can be shared before a peer joins.
            let (sender, receiver) = gossip.subscribe(topic, vec![]).await?.split();

            hub.set_welcome(NetworkEvent::RoomReady {
                ticket:  ticket.to_string(),
                peer_id: local_id.clone(),
                room:    room.clone(),
                ts:      unix_millis(),
            });

            tokio::spawn(announce_room(
                room.clone(), ticket.to_string(), local_id.clone(),
                registry_port, shutdown_rx.clone(),
            ));

            tokio::select! {
                r = run_gossip(local_id, sender, receiver, hub, outbound_rx, neighbor_tx, shutdown_rx) => {
                    if let Err(e) = r { warn!(target: "relay_test::chat", "gossip error: {e}"); }
                }
                _ = tokio::signal::ctrl_c() => {
                    info!(target: "relay_test::chat", "ctrl-c — shutting down");
                }
            }

            let _ = shutdown_tx.send(true);
            let _ = tokio::time::timeout(Duration::from_secs(5), serve_handle).await;
        }

        Command::Join { ticket, room, ws_port } => {
            let chat_ticket: ChatTicket = ticket.parse()?;
            // Use the topic encoded in the ticket — it is the hash of the room name peer A used.
            // Computing room_to_topic(&room) here would only work if "room" matches exactly.
            let topic       = chat_ticket.topic;
            let outbound_rx = hub.start_room();

            let bootstrap: Vec<_> = chat_ticket.peers.iter().map(|p| p.id).collect();
            for peer in chat_ticket.peers {
                memory_lookup.add_endpoint_info(peer);
            }

            println!("=================================================");
            println!("CHAT room: {room}");
            println!("Local peer: {}", endpoint.id());
            println!("WebSocket: ws://127.0.0.1:{ws_port}");
            println!("Connecting to {} known peer(s)...", bootstrap.len());
            println!("=================================================");

            let hub_ws = hub.clone();
            let serve_handle = tokio::spawn({
                let sd = shutdown_rx.clone();
                async move { ws_bridge::serve(ws_port, hub_ws, None, sd).await }
            });

            // Non-blocking subscribe with bootstrap list — same approach as Open.
            let (sender, receiver) = gossip.subscribe(topic, bootstrap).await?.split();

            hub.set_welcome(NetworkEvent::RoomJoined {
                peer_id: local_id.clone(),
                room:    room.clone(),
                ts:      unix_millis(),
            });

            info!(target: "relay_test::chat", "joining gossip topic (P2P connection in background)");

            tokio::select! {
                r = run_gossip(local_id, sender, receiver, hub, outbound_rx, neighbor_tx, shutdown_rx) => {
                    if let Err(e) = r { warn!(target: "relay_test::chat", "gossip error: {e}"); }
                }
                _ = tokio::signal::ctrl_c() => {
                    info!(target: "relay_test::chat", "ctrl-c — shutting down");
                }
            }

            let _ = shutdown_tx.send(true);
            let _ = tokio::time::timeout(Duration::from_secs(5), serve_handle).await;
        }

        Command::Serve { ws_port, registry_port } => {
            let (cmd_tx, mut cmd_rx) = mpsc::channel::<RoomCommand>(4);

            let hub_ws = hub.clone();
            let serve_handle = tokio::spawn({
                let sd = shutdown_rx.clone();
                async move { ws_bridge::serve(ws_port, hub_ws, Some(cmd_tx), sd).await }
            });

            // Single ctrl-c watcher for the entire serve session.
            // A watch channel is "sticky": even if ctrl-c fires in the brief gap between
            // the idle select resolving and run_room being entered, the receiver's
            // last-seen version is still stale, so the next changed() call resolves immediately.
            let (ctrlc_tx, mut ctrlc_rx) = watch::channel(false);
            tokio::spawn(async move {
                tokio::signal::ctrl_c().await.ok();
                info!(target: "relay_test::chat", "ctrl-c — shutting down");
                let _ = ctrlc_tx.send(true);
            });

            info!(target: "relay_test::chat", ws_port, "serve mode: peer ready, waiting for room commands");

            // Persistent peer loop: idle → room → idle → room → ...
            'peer: loop {
                // Check if ctrl-c already fired (e.g., during the previous room teardown).
                if *ctrlc_rx.borrow() { break 'peer; }

                // Idle phase: wait for the next Open/Join command or ctrl-c.
                let cmd = tokio::select! {
                    c = cmd_rx.recv() => c,
                    result = ctrlc_rx.changed() => {
                        match result {
                            Ok(()) if *ctrlc_rx.borrow() => break 'peer,
                            _ => continue,
                        }
                    }
                };

                let room_exit = match cmd {
                    None => break 'peer, // cmd channel closed (bridge exited)
                    Some(RoomCommand::Shutdown | RoomCommand::Leave) => {
                        // Spurious leave/shutdown with no active room — ignore.
                        continue 'peer;
                    }

                    Some(RoomCommand::Open { room }) => {
                        let outbound_rx        = hub.start_room();
                        let (room_sd_tx, room_sd_rx) = watch::channel(false);

                        let topic  = room_to_topic(&room);
                        let me     = endpoint.addr();
                        let ticket = ChatTicket { topic, peers: vec![me] };

                        info!(target: "relay_test::chat", %room, "opening room");
                        let (sender, receiver) = gossip.subscribe(topic, vec![]).await?.split();

                        hub.set_welcome(NetworkEvent::RoomReady {
                            ticket:  ticket.to_string(),
                            peer_id: local_id.clone(),
                            room:    room.clone(),
                            ts:      unix_millis(),
                        });

                        tokio::spawn(announce_room(
                            room, ticket.to_string(), local_id.clone(),
                            registry_port, room_sd_rx.clone(),
                        ));

                        let exit = run_room(
                            local_id.clone(), sender, receiver, hub.clone(),
                            outbound_rx, neighbor_tx.clone(), room_sd_rx, &mut cmd_rx,
                            &mut ctrlc_rx, true,
                        ).await;

                        let _ = room_sd_tx.send(true); // deregister from registry
                        exit
                    }

                    Some(RoomCommand::Join { room, ticket }) => {
                        let chat_ticket = match ticket.parse::<ChatTicket>() {
                            Ok(t)  => t,
                            Err(e) => {
                                warn!(target: "relay_test::chat", "invalid ticket: {e}");
                                continue 'peer;
                            }
                        };
                        let outbound_rx = hub.start_room();
                        let (room_sd_tx, room_sd_rx) = watch::channel(false);

                        // Use the TopicId from the ticket — it is the canonical topic, regardless
                        // of what room label the joiner typed (room name is peer A's concern).
                        let topic       = chat_ticket.topic;
                        let bootstrap: Vec<_> = chat_ticket.peers.iter().map(|p| p.id).collect();
                        for peer in chat_ticket.peers {
                            memory_lookup.add_endpoint_info(peer);
                        }

                        info!(target: "relay_test::chat", %room, "joining room");
                        let (sender, receiver) = gossip.subscribe(topic, bootstrap).await?.split();

                        hub.set_welcome(NetworkEvent::RoomJoined {
                            peer_id: local_id.clone(),
                            room:    room.clone(),
                            ts:      unix_millis(),
                        });

                        let exit = run_room(
                            local_id.clone(), sender, receiver, hub.clone(),
                            outbound_rx, neighbor_tx.clone(), room_sd_rx, &mut cmd_rx,
                            &mut ctrlc_rx, false,
                        ).await;

                        let _ = room_sd_tx.send(true);
                        exit
                    }
                };

                match room_exit {
                    RoomExit::Leave => {
                        hub.end_room();
                        let _ = hub.event_tx.send(NetworkEvent::RoomLeft { ts: unix_millis() });
                        info!(target: "relay_test::chat", "left room, back to idle");
                        continue 'peer;
                    }
                    RoomExit::Shutdown | RoomExit::CtrlC => break 'peer,
                }
            }

            let _ = shutdown_tx.send(true);
            let _ = tokio::time::timeout(Duration::from_secs(5), serve_handle).await;
        }
    }

    router.shutdown().await?;
    Ok(())
}

/// Why a room session ended.
enum RoomExit {
    /// Peer left the room; the serve process stays alive for the next command.
    Leave,
    /// Host-initiated full shutdown; the serve process should exit.
    Shutdown,
    /// Ctrl-C received; the serve process should exit.
    CtrlC,
}

/// Drive one room session to completion. Returns when the room is over.
/// Monitors `cmd_rx` and `ctrlc_rx` concurrently so all exit paths are covered.
/// `ctrlc_rx` is the same receiver used in the outer peer loop — its last-seen
/// version persists, so a ctrl-c that fired during the brief setup gap before
/// this function was called is still detected immediately.
///
/// `broadcast_close`: when true (host/opener), broadcasts `GossipFrame::RoomClosed` over
/// gossip before returning so remote peers receive a prompt room-ended signal.
/// Guests (joiners) set this to false — their departure doesn't close the room.
async fn run_room(
    local_id:       String,
    sender:         GossipSender,
    receiver:       GossipReceiver,
    hub:            ChatHub,
    outbound_rx:    mpsc::Receiver<String>,
    neighbor_tx:    mpsc::Sender<PeerEvent>,
    room_sd_rx:     watch::Receiver<bool>,
    cmd_rx:         &mut mpsc::Receiver<RoomCommand>,
    ctrlc_rx:       &mut watch::Receiver<bool>,
    broadcast_close: bool,
) -> RoomExit {
    // Clone sender BEFORE moving it into run_gossip so we can broadcast
    // RoomClosed after the gossip session ends (sender is still alive in
    // the spawned send_handle task for a brief window after select! fires).
    let close_sender = sender.clone();

    let exit = tokio::select! {
        r = run_gossip(local_id, sender, receiver, hub, outbound_rx, neighbor_tx, room_sd_rx) => {
            if let Err(e) = r { warn!(target: "relay_test::chat", "gossip error: {e}"); }
            RoomExit::Leave
        }
        result = ctrlc_rx.changed() => {
            match result {
                Ok(()) if *ctrlc_rx.borrow() => RoomExit::CtrlC,
                _ => RoomExit::Leave,
            }
        }
        cmd = cmd_rx.recv() => {
            match cmd {
                Some(RoomCommand::Shutdown) => RoomExit::Shutdown,
                Some(RoomCommand::Leave) | None => RoomExit::Leave,
                _ => RoomExit::Leave,
            }
        }
    };

    // Broadcast RoomClosed so remote peers get a prompt signal.
    // The spawned send_handle inside run_gossip is still alive briefly; the clone
    // routes through the same gossip topic. Best-effort: ignore any send error.
    if broadcast_close {
        if let Ok(bytes) = GossipFrame::RoomClosed.to_bytes() {
            let _ = close_sender.broadcast(bytes).await;
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    exit
}

/// Connect to the registry WS and hold the connection open as a liveness signal.
/// Disconnects when `shutdown_rx` fires (room deregisters automatically).
async fn announce_room(
    room:          String,
    ticket:        String,
    peer_id:       String,
    registry_port: u16,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let url = format!("ws://127.0.0.1:{registry_port}");
    let ws = match tokio_tungstenite::connect_async(&url).await {
        Ok((ws, _)) => ws,
        Err(e) => {
            warn!(target: "relay_test::chat", %url, "registry not reachable: {e} (room won't be listed)");
            return;
        }
    };
    let (mut tx, mut rx) = ws.split();

    let body = serde_json::json!({
        "role":       "announce",
        "room":       room,
        "ticket":     ticket,
        "peer_id":    peer_id,
        "opened_at":  unix_millis(),
    });
    if let Err(e) = tx.send(Message::Text(body.to_string())).await {
        warn!(target: "relay_test::chat", "registry announce send error: {e}");
        return;
    }

    // Hold the connection open until shutdown — connection drop = room deregistered.
    loop {
        tokio::select! {
            result = shutdown_rx.changed() => {
                match result {
                    Ok(()) if *shutdown_rx.borrow() => break,
                    Err(_) => break,
                    _ => {}
                }
            }
            msg = rx.next() => {
                match msg {
                    Some(Ok(Message::Ping(p))) => { let _ = tx.send(Message::Pong(p)).await; }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}

fn room_to_topic(room: &str) -> iroh_gossip::proto::TopicId {
    iroh_gossip::proto::TopicId::from_bytes(*blake3::hash(room.as_bytes()).as_bytes())
}

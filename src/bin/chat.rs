use std::time::Duration;

use anyhow::Result;
use clap::{Parser, Subcommand};
use iroh::{
    RelayMode, RelayUrl,
    address_lookup::memory::MemoryLookup,
    endpoint::presets,
    protocol::Router,
    Endpoint,
};
use iroh_gossip::net::{Gossip, GOSSIP_ALPN};
use tokio::sync::{mpsc, watch};
use tracing::{info, warn};

use relay_test::{
    chat::{ChatHub, run_gossip},
    logging::init_logging,
    protocol::ChatTicket,
    tracing_tasks::{PeerEvent, spawn_net_report_logger, spawn_remote_info_logger},
    ws_bridge,
};

const RELAY_URL: &str = "https://relay.jeong.cloud:8843";

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
        /// Room name (determines the gossip topic).
        #[arg(long, default_value = "default")]
        room: String,
        /// Local WebSocket port for the frontend.
        #[arg(long, default_value = "9001")]
        ws_port: u16,
    },
    /// Join a chat room from a ticket.
    Join {
        /// Ticket printed by `open`.
        ticket: String,
        /// Room name (must match the opener's --room).
        #[arg(long, default_value = "default")]
        room: String,
        /// Local WebSocket port for the frontend.
        #[arg(long, default_value = "9002")]
        ws_port: u16,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let (_guard, event_tx) = init_logging("chat")?;
    let args = Args::parse();

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
        Err(_) => tracing::warn!(target: "relay_test::chat", "timed out waiting for relay — continuing anyway"),
    }

    let gossip = Gossip::builder().spawn(endpoint.clone());
    let router = Router::builder(endpoint.clone())
        .accept(GOSSIP_ALPN, gossip.clone())
        .spawn();

    let (outbound_tx, outbound_rx) = mpsc::channel::<String>(64);
    let (neighbor_tx, neighbor_rx) = mpsc::channel::<PeerEvent>(32);

    let hub = ChatHub::new(outbound_tx, event_tx);

    spawn_remote_info_logger(endpoint.clone(), neighbor_rx);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    match args.command {
        Command::Open { room, ws_port } => {
            let topic = room_to_topic(&room);
            let me = endpoint.addr();

            let ticket = ChatTicket {
                topic,
                peers: vec![me],
            };
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
                async move { ws_bridge::serve(ws_port, hub_ws, sd).await }
            });

            info!(target: "relay_test::chat", "waiting for peers to join...");
            let (sender, receiver) = gossip.subscribe_and_join(topic, vec![]).await?.split();
            info!(target: "relay_test::chat", "first peer connected");

            tokio::select! {
                r = run_gossip(local_id, sender, receiver, hub, outbound_rx, neighbor_tx, shutdown_rx) => {
                    if let Err(e) = r { warn!(target: "relay_test::chat", "gossip ended with error: {e}"); }
                }
                _ = tokio::signal::ctrl_c() => {
                    info!(target: "relay_test::chat", "ctrl-c received — shutting down");
                }
            }

            let _ = shutdown_tx.send(true);
            let _ = tokio::time::timeout(Duration::from_secs(5), serve_handle).await;
        }

        Command::Join { ticket, room, ws_port } => {
            let chat_ticket: ChatTicket = ticket.parse()?;
            let topic = room_to_topic(&room);

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
                async move { ws_bridge::serve(ws_port, hub_ws, sd).await }
            });

            let (sender, receiver) = gossip.subscribe_and_join(topic, bootstrap).await?.split();
            info!(target: "relay_test::chat", "connected to gossip topic");

            tokio::select! {
                r = run_gossip(local_id, sender, receiver, hub, outbound_rx, neighbor_tx, shutdown_rx) => {
                    if let Err(e) = r { warn!(target: "relay_test::chat", "gossip ended with error: {e}"); }
                }
                _ = tokio::signal::ctrl_c() => {
                    info!(target: "relay_test::chat", "ctrl-c received — shutting down");
                }
            }

            let _ = shutdown_tx.send(true);
            let _ = tokio::time::timeout(Duration::from_secs(5), serve_handle).await;
        }
    }

    router.shutdown().await?;
    Ok(())
}

fn room_to_topic(room: &str) -> iroh_gossip::proto::TopicId {
    iroh_gossip::proto::TopicId::from_bytes(*blake3::hash(room.as_bytes()).as_bytes())
}

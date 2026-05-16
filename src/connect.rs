use std::{sync::Arc, time::Duration};

use anyhow::Result;
use clap::Parser;
use iroh::{endpoint::presets, Endpoint, RelayConfig, RelayMode, RelayUrl};
use iroh_tickets::endpoint::EndpointTicket;

use relay_test::{
    logging::init_logging,
    tracing_tasks::{spawn_net_report_logger, spawn_path_logger},
};

const ALPN: &[u8] = b"relay-test/echo/0";

#[derive(Parser)]
struct Args {
    /// EndpointTicket printed by the `listen` binary
    ticket: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let (_guard, event_tx) = init_logging("connect")?;
    let args = Args::parse();

    let ticket: EndpointTicket = args.ticket.parse()?;
    let addr = ticket.endpoint_addr().clone();

    let relay_url: RelayUrl = "https://relay.jeong.cloud:8843".parse()?;
    let crypto_provider = iroh_relay::tls::default_provider();

    let endpoint = Endpoint::builder(presets::Empty)
        .relay_mode(RelayMode::Disabled)
        .alpns(vec![ALPN.to_vec()])
        .crypto_provider(crypto_provider)
        .bind()
        .await?;

    let relay_config = Arc::new(RelayConfig::new(relay_url.clone(), None));
    endpoint.insert_relay(relay_url, relay_config).await;

    spawn_net_report_logger(endpoint.clone(), event_tx);

    match tokio::time::timeout(Duration::from_secs(10), endpoint.online()).await {
        Ok(()) => {}
        Err(_) => {
            tracing::warn!("timed out waiting for relay — continuing anyway");
        }
    }

    println!("CONNECTOR endpoint id: {}", endpoint.id());
    println!("Connecting to: {}", addr.id);

    let conn = endpoint.connect(addr, ALPN).await?;
    println!("Connection established");

    spawn_path_logger(conn.clone(), "connector->listener");

    let (mut send, mut recv) = conn.open_bi().await?;
    send.write_all(b"hello from connector").await?;
    send.finish()?;

    let reply = recv.read_to_end(64 * 1024).await?;
    println!("Got reply: {:?}", String::from_utf8_lossy(&reply));

    conn.close(0u32.into(), b"done");
    endpoint.close().await;
    Ok(())
}

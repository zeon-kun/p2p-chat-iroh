use std::{sync::Arc, time::Duration};

use anyhow::Result;
use iroh::{endpoint::presets, Endpoint, RelayMode, RelayUrl};
use iroh_relay::RelayConfig;
use iroh_tickets::endpoint::EndpointTicket;

use relay_test::{
    logging::init_logging,
    tracing_tasks::{spawn_net_report_logger, spawn_path_logger},
};

const ALPN: &[u8] = b"relay-test/echo/0";

#[tokio::main]
async fn main() -> Result<()> {
    let (_guard, event_tx) = init_logging("listen")?;

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
            tracing::warn!("timed out waiting for relay — ticket may lack relay addresses");
        }
    }

    let addr = endpoint.addr();
    let ticket = EndpointTicket::new(addr.clone());

    println!("=================================================");
    println!("LISTENER endpoint id: {}", endpoint.id());
    println!();
    println!("Relays:  {:?}", addr.relay_urls().collect::<Vec<_>>());
    println!("IPs:     {:?}", addr.ip_addrs().collect::<Vec<_>>());
    println!();
    println!("TICKET (give this to the connector):");
    println!("  {}", ticket);
    println!("=================================================");

    while let Some(incoming) = endpoint.accept().await {
        let conn = incoming.await?;
        let remote = conn.remote_id();
        println!("\n>>> incoming from: {}", remote);

        spawn_path_logger(conn.clone(), "listener<-connector");

        let (mut send, mut recv) = conn.accept_bi().await?;
        let bytes = recv.read_to_end(64 * 1024).await?;
        let msg = String::from_utf8_lossy(&bytes);
        println!(">>> received: {:?}", msg);

        let reply = format!("echo: {}", msg);
        send.write_all(reply.as_bytes()).await?;
        send.finish()?;
        conn.closed().await;
        println!(">>> replied and closed\n");
    }

    Ok(())
}

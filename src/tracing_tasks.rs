use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use iroh::{
    EndpointId, NetReport, TransportAddr, Watcher,
    endpoint::{Connection, PathInfo, PathWatcher, RemoteInfo},
};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use tracing::{info, warn};

use crate::protocol::{unix_millis, NetworkEvent, RelayLatency};

pub fn spawn_net_report_logger(
    endpoint: iroh::Endpoint,
    event_tx: broadcast::Sender<NetworkEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut w = endpoint.net_report();
        let first = w.initialized().await;
        emit_net_report(&first, &event_tx);
        loop {
            match w.updated().await {
                Err(_) => break,
                Ok(Some(r)) => emit_net_report(&r, &event_tx),
                Ok(None) => {}
            }
        }
    })
}

fn emit_net_report(r: &NetReport, event_tx: &broadcast::Sender<NetworkEvent>) {
    let relay_latencies: Vec<RelayLatency> = r
        .relay_latency
        .iter()
        .map(|(probe, url, dur)| RelayLatency {
            probe: format!("{probe:?}"),
            url:   url.to_string(),
            ms:    dur.as_millis() as u64,
        })
        .collect();

    // Log the latencies as a plain string list for the file
    let latency_strs: Vec<String> = relay_latencies
        .iter()
        .map(|l| format!("{} = {}ms", l.url, l.ms))
        .collect();
    info!(
        target: "relay_test::netreport",
        preferred_relay = ?r.preferred_relay,
        has_udp = r.has_udp(),
        mapping_varies = ?r.mapping_varies_by_dest(),
        udp_v4 = r.udp_v4,
        udp_v6 = r.udp_v6,
        global_v4 = ?r.global_v4,
        global_v6 = ?r.global_v6,
        captive_portal = ?r.captive_portal,
        relay_latencies = ?latency_strs,
        "net_report update"
    );

    let _ = event_tx.send(NetworkEvent::NetReport {
        preferred_relay: r.preferred_relay.as_ref().map(|u| u.to_string()),
        relay_latencies,
        udp_v4:         r.udp_v4,
        udp_v6:         r.udp_v6,
        captive_portal: r.captive_portal,
        ts:             unix_millis(),
    });
}

/// Per-connection path logger — used by the raw listen/connect debug bins.
pub fn spawn_path_logger(conn: Connection, label: &'static str) -> JoinHandle<()> {
    tokio::spawn(async move {
        let remote = conn.remote_id();
        let mut watcher: PathWatcher = conn.paths();
        let mut prev_kind: Option<&'static str> = None;

        loop {
            let paths = match watcher.updated().await {
                Err(_) => break,
                Ok(p) => p,
            };
            let selected: Option<&PathInfo> = paths.iter().find(|p| p.is_selected());
            if let Some(path) = selected {
                let (kind, detail) = match path.remote_addr() {
                    TransportAddr::Relay(url) => ("RELAY", format!("relay={url}")),
                    TransportAddr::Ip(addr) => ("DIRECT", format!("addr={addr}")),
                    _ => ("CUSTOM", "custom".to_string()),
                };
                if prev_kind != Some(kind) {
                    if let Some(prev) = prev_kind {
                        warn!(
                            target: "relay_test::path",
                            %remote,
                            label,
                            "path transition {prev}->{kind}"
                        );
                    }
                    prev_kind = Some(kind);
                }
                info!(
                    target: "relay_test::path",
                    %remote,
                    label,
                    kind,
                    detail,
                    path_id = ?path.id(),
                    "selected path"
                );
            }
        }
    })
}

/// Remote-info poller — used by the gossip chat bin.
pub fn spawn_remote_info_logger(
    endpoint: iroh::Endpoint,
    mut peer_rx: mpsc::Receiver<PeerEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let peers: Arc<Mutex<HashSet<EndpointId>>> = Arc::new(Mutex::new(HashSet::new()));
        let poll_interval = Duration::from_secs(5);

        loop {
            tokio::select! {
                event = peer_rx.recv() => {
                    match event {
                        None => break,
                        Some(PeerEvent::Up(id)) => {
                            info!(target: "relay_test::remoteinfo", peer = %id, "neighbor up");
                            peers.lock().unwrap().insert(id);
                        }
                        Some(PeerEvent::Down(id)) => {
                            info!(target: "relay_test::remoteinfo", peer = %id, "neighbor down");
                            peers.lock().unwrap().remove(&id);
                        }
                    }
                }
                _ = tokio::time::sleep(poll_interval) => {
                    let ids: Vec<EndpointId> = peers.lock().unwrap().iter().cloned().collect();
                    for id in ids {
                        if let Some(info) = endpoint.remote_info(id).await {
                            log_remote_info(&info);
                        }
                    }
                }
            }
        }
    })
}

fn log_remote_info(info: &RemoteInfo) {
    let peer = info.id();
    for addr_info in info.addrs() {
        let (kind, detail) = match addr_info.addr() {
            TransportAddr::Relay(url) => ("RELAY", format!("relay={url}")),
            TransportAddr::Ip(addr) => ("DIRECT", format!("addr={addr}")),
            _ => ("CUSTOM", "custom".to_string()),
        };
        info!(
            target: "relay_test::remoteinfo",
            %peer,
            kind,
            detail,
            usage = ?addr_info.usage(),
            "remote addr"
        );
    }
}

#[derive(Debug)]
pub enum PeerEvent {
    Up(EndpointId),
    Down(EndpointId),
}

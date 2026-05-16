use anyhow::Result;
use time::{macros::format_description, OffsetDateTime};
use tokio::sync::broadcast;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::{protocol::NetworkEvent, telemetry::TelemetryLayer};

pub fn init_logging(bin_name: &str) -> Result<(WorkerGuard, broadcast::Sender<NetworkEvent>)> {
    std::fs::create_dir_all("logs")?;

    let fmt = format_description!("[year]-[month]-[day]T[hour]-[minute]-[second]Z");
    let ts = OffsetDateTime::now_utc().format(fmt)?;
    let file_name = format!("{bin_name}-{ts}.log");

    let appender = tracing_appender::rolling::never("logs", file_name);
    let (non_blocking, guard) = tracing_appender::non_blocking(appender);

    let console_filter = EnvFilter::new("info,relay_test=info");
    let file_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new("info,iroh=debug,iroh::_events=trace,iroh_gossip=debug,relay_test=debug")
    });
    // Independent per-layer filter — allows the iroh tracing targets the Layer needs
    // regardless of what the console/file filters accept.
    let telemetry_filter = EnvFilter::new(
        "iroh::_events=trace,iroh::socket=debug,iroh_relay::ping_tracker=debug",
    );

    let (event_tx, _rx) = broadcast::channel::<NetworkEvent>(512);
    let telemetry_layer = TelemetryLayer { tx: event_tx.clone() };

    let console_layer = fmt::layer().with_writer(std::io::stdout).with_filter(console_filter);
    let file_layer = fmt::layer()
        .with_ansi(false)
        .with_writer(non_blocking)
        .with_filter(file_filter);

    tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer)
        .with(telemetry_layer.with_filter(telemetry_filter))
        .init();

    Ok((guard, event_tx))
}

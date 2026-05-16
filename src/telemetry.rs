use tokio::sync::broadcast;
use tracing::{field::Visit, Subscriber};
use tracing_subscriber::Layer;

use crate::protocol::{unix_millis, NetworkEvent};

pub struct TelemetryLayer {
    pub tx: broadcast::Sender<NetworkEvent>,
}

impl<S: Subscriber> Layer<S> for TelemetryLayer {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let target = event.metadata().target();
        let mut v = FieldVisitor::default();
        event.record(&mut v);

        let ev = match target {
            "iroh::_events::path::selected" => {
                let transport = if v.path_remote.contains("Ip(") { "direct" } else { "relay" };
                let addr = extract_addr(&v.path_remote);
                Some(NetworkEvent::PathSelected {
                    remote:    v.remote.clone(),
                    transport: transport.to_string(),
                    addr,
                    rtt_ms:   v.rtt.as_deref().and_then(parse_dur_ms),
                    ts:        unix_millis(),
                })
            }
            "iroh::_events::relay::connected" => {
                let url = extract_relay_url(&v.url);
                let home = v.home_relay == "true";
                Some(NetworkEvent::RelayConnected { url, home, ts: unix_millis() })
            }
            "iroh::_events::conn::connected" => {
                Some(NetworkEvent::ConnEstablished {
                    remote: v.remote_id.clone(),
                    side:   v.side.clone(),
                    alpn:   v.alpn.clone(),
                    ts:     unix_millis(),
                })
            }
            "iroh::socket" => {
                if v.message.starts_with("scheduling periodic_stun to run in") {
                    let in_secs = parse_stun_secs(&v.message).unwrap_or(0);
                    Some(NetworkEvent::StunScheduled { in_secs, ts: unix_millis() })
                } else {
                    None
                }
            }
            "iroh_relay::ping_tracker" => {
                if v.message.starts_with("Pong received") {
                    v.rtt.as_deref().and_then(parse_dur_ms).map(|rtt_ms| {
                        NetworkEvent::RelayPong { rtt_ms, ts: unix_millis() }
                    })
                } else {
                    None
                }
            }
            _ => None,
        };

        if let Some(e) = ev {
            let _ = self.tx.send(e);
        }
    }
}

// ── field visitor ─────────────────────────────────────────────────────────────

#[derive(Default)]
struct FieldVisitor {
    message:     String,
    rtt:         Option<String>,
    remote:      String,
    path_remote: String,
    url:         String,
    home_relay:  String,
    remote_id:   String,
    side:        String,
    alpn:        String,
}

impl Visit for FieldVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        let s = format!("{value:?}");
        match field.name() {
            "message"     => self.message     = strip_quotes(&s),
            "rtt"         => self.rtt         = Some(strip_quotes(&s)),
            "remote"      => self.remote      = strip_quotes(&s),
            "path_remote" => self.path_remote = strip_quotes(&s),
            "url"         => self.url         = strip_quotes(&s),
            "home_relay"  => self.home_relay  = strip_quotes(&s),
            "remote_id"   => self.remote_id   = strip_quotes(&s),
            "side"        => self.side        = strip_quotes(&s),
            "alpn"        => self.alpn        = strip_quotes(&s),
            _ => {}
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        match field.name() {
            "message"     => self.message     = value.to_string(),
            "rtt"         => self.rtt         = Some(value.to_string()),
            "remote"      => self.remote      = value.to_string(),
            "path_remote" => self.path_remote = value.to_string(),
            "url"         => self.url         = value.to_string(),
            "home_relay"  => self.home_relay  = value.to_string(),
            "remote_id"   => self.remote_id   = value.to_string(),
            "side"        => self.side        = value.to_string(),
            "alpn"        => self.alpn        = value.to_string(),
            _ => {}
        }
    }

    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        if field.name() == "home_relay" {
            self.home_relay = value.to_string();
        }
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn strip_quotes(s: &str) -> String {
    s.trim_matches('"').to_string()
}

/// Parse a Debug-formatted Duration string like `27.088986ms`, `1.70942ms`,
/// `450µs`, `1.5s`, `300ns` into floating-point milliseconds.
pub fn parse_dur_ms(s: &str) -> Option<f64> {
    let s = s.trim().trim_matches('"');
    if let Some(v) = s.strip_suffix("ms") {
        return v.trim().parse::<f64>().ok();
    }
    if let Some(v) = s.strip_suffix("µs").or_else(|| s.strip_suffix("us")) {
        return v.trim().parse::<f64>().ok().map(|us| us / 1_000.0);
    }
    if let Some(v) = s.strip_suffix("ns") {
        return v.trim().parse::<f64>().ok().map(|ns| ns / 1_000_000.0);
    }
    if let Some(v) = s.strip_suffix('s') {
        return v.trim().parse::<f64>().ok().map(|sec| sec * 1_000.0);
    }
    None
}

/// Extract a clean URL string from Debug-formatted `RelayUrl("https://…")` or plain url.
fn extract_relay_url(s: &str) -> String {
    let s = s.trim_matches('"');
    if let Some(inner) = s.strip_prefix("RelayUrl(\"").and_then(|t| t.strip_suffix("\")")) {
        return inner.to_string();
    }
    s.to_string()
}

/// Extract the socket addr / relay url string from Debug-formatted
/// `Ip(10.255.255.254:46220)` or `RelayUrl("https://…")`.
fn extract_addr(s: &str) -> String {
    let s = s.trim_matches('"');
    if let Some(inner) = s.strip_prefix("Ip(").and_then(|t| t.strip_suffix(')')) {
        return inner.to_string();
    }
    extract_relay_url(s)
}

/// Parse `"scheduling periodic_stun to run in 20s"` → 20.
fn parse_stun_secs(msg: &str) -> Option<u64> {
    // Examples: "…run in 20s", "…run immediately and in 23s"
    let last_word = msg.split_whitespace().last()?;
    last_word.strip_suffix('s')?.parse::<u64>().ok()
}

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::services::api_client::ApiClient;
use crate::services::peer_cache_server::PeerAdvertiseInfo;

const PEER_LIST_CACHE_TTL: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum PeerScope {
    Lan = 0,
    Vpn = 1,
    Other = 2,
}

#[derive(Clone, Debug)]
pub struct PeerCandidate {
    pub peer_id: String,
    pub base_urls: Vec<String>,
    pub upload_limit_bps: u64,
    pub scope: PeerScope,
}

#[derive(Clone)]
pub struct PeerCoordinator {
    api: ApiClient,
    advertise: PeerAdvertiseInfo,
    device_id: String,
    started: Arc<AtomicBool>,
    state: Arc<Mutex<PeerCoordinatorState>>,
}

struct PeerCoordinatorState {
    peer_id: Option<String>,
    heartbeat_interval_s: u64,
    peers_cache: HashMap<String, (Instant, Vec<PeerCandidate>)>,
}

#[derive(Clone, Serialize)]
struct RegisterPayload {
    device_id: String,
    port: u16,
    addresses: Vec<String>,
    share_enabled: bool,
    upload_limit_bps: u64,
}

#[derive(Deserialize)]
struct RegisterResponse {
    peer_id: String,
    heartbeat_interval_s: u64,
}

#[derive(Clone, Serialize)]
struct HeartbeatPayload {
    peer_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    addresses: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    share_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    upload_limit_bps: Option<u64>,
}

#[derive(Deserialize)]
struct HeartbeatResponse {
    ok: bool,
    heartbeat_interval_s: u64,
}

#[derive(Deserialize)]
struct PeerListResponse {
    peers: Vec<PeerOut>,
}

#[derive(Deserialize)]
struct PeerOut {
    peer_id: String,
    port: u16,
    addresses: Vec<String>,
    upload_limit_bps: u64,
    #[allow(dead_code)]
    last_seen_at: Option<String>,
}

impl PeerCoordinator {
    pub fn new(api: ApiClient, advertise: PeerAdvertiseInfo) -> Option<Self> {
        if !advertise.enabled {
            return None;
        }
        Some(Self {
            api,
            advertise,
            device_id: resolve_device_id(),
            started: Arc::new(AtomicBool::new(false)),
            state: Arc::new(Mutex::new(PeerCoordinatorState {
                peer_id: None,
                heartbeat_interval_s: 20,
                peers_cache: HashMap::new(),
            })),
        })
    }

    pub fn start(&self) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            this.run_heartbeat_loop().await;
        });
    }

    async fn run_heartbeat_loop(self) {
        if let Err(err) = self.register().await {
            tracing::warn!("p2p register failed: {}", err);
        }
        loop {
            let delay_secs = self.current_heartbeat_interval().max(8).min(120);
            tokio::time::sleep(Duration::from_secs(delay_secs)).await;
            if let Err(err) = self.heartbeat().await {
                tracing::warn!("p2p heartbeat failed: {}", err);
                let _ = self.register().await;
            }
        }
    }

    pub async fn peers_for_game(&self, game_id: &str) -> Vec<PeerCandidate> {
        if game_id.trim().is_empty() {
            return Vec::new();
        }

        if let Ok(locked) = self.state.lock() {
            if let Some((cached_at, peers)) = locked.peers_cache.get(game_id) {
                if cached_at.elapsed() < PEER_LIST_CACHE_TTL {
                    return peers.clone();
                }
            }
        }

        let self_peer_id = self
            .state
            .lock()
            .ok()
            .and_then(|locked| locked.peer_id.clone());
        let mut path = format!("p2p/peers?game_id={}", urlencoding::encode(game_id));
        if let Some(value) = self_peer_id {
            path.push_str("&peer_id=");
            path.push_str(&urlencoding::encode(&value));
        }
        let response: PeerListResponse = match self.api.get(&path, true).await {
            Ok(value) => value,
            Err(err) => {
                tracing::debug!("p2p peers fetch failed for game_id={}: {}", game_id, err);
                return Vec::new();
            }
        };

        let peers = response
            .peers
            .into_iter()
            .filter_map(|peer| peer_to_candidate(peer))
            .collect::<Vec<_>>();

        if let Ok(mut locked) = self.state.lock() {
            locked
                .peers_cache
                .insert(game_id.to_string(), (Instant::now(), peers.clone()));
        }
        peers
    }

    async fn register(&self) -> crate::errors::Result<()> {
        let payload = RegisterPayload {
            device_id: self.device_id.clone(),
            port: self.advertise.port,
            addresses: self.advertise.addresses.clone(),
            share_enabled: self.advertise.share_enabled,
            upload_limit_bps: self.advertise.upload_limit_bps,
        };
        let response: RegisterResponse = self.api.post("p2p/peers/register", payload, true).await?;
        if let Ok(mut locked) = self.state.lock() {
            locked.peer_id = Some(response.peer_id);
            locked.heartbeat_interval_s = response.heartbeat_interval_s.max(8).min(120);
        }
        Ok(())
    }

    async fn heartbeat(&self) -> crate::errors::Result<()> {
        let peer_id = self
            .state
            .lock()
            .ok()
            .and_then(|locked| locked.peer_id.clone());
        let Some(peer_id) = peer_id else {
            return self.register().await;
        };

        let payload = HeartbeatPayload {
            peer_id,
            addresses: None,
            port: None,
            share_enabled: None,
            upload_limit_bps: None,
        };
        let response: HeartbeatResponse =
            self.api.post("p2p/peers/heartbeat", payload, true).await?;
        if let Ok(mut locked) = self.state.lock() {
            locked.heartbeat_interval_s = response.heartbeat_interval_s.max(8).min(120);
            if !response.ok {
                locked.peer_id = None;
            }
        }
        Ok(())
    }

    fn current_heartbeat_interval(&self) -> u64 {
        self.state
            .lock()
            .ok()
            .map(|locked| locked.heartbeat_interval_s.max(8).min(120))
            .unwrap_or(20)
    }
}

pub fn build_chunk_peer_urls(
    chunk_hash: &str,
    peers: &[PeerCandidate],
    fanout: usize,
) -> Vec<String> {
    if peers.is_empty() || chunk_hash.trim().is_empty() {
        return Vec::new();
    }
    let fanout = fanout.max(1).min(6);
    let hash = chunk_hash.to_ascii_lowercase();

    let mut ranked = peers
        .iter()
        .map(|peer| {
            let key = format!("{hash}:{}", peer.peer_id);
            let digest = blake3::hash(key.as_bytes());
            let bytes = digest.as_bytes();
            let score = u64::from_le_bytes([
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            ]);
            (peer, score)
        })
        .collect::<Vec<_>>();

    ranked.sort_by(|(left_peer, left_score), (right_peer, right_score)| {
        left_peer
            .scope
            .cmp(&right_peer.scope)
            .then_with(|| right_score.cmp(left_score))
            .then_with(|| left_peer.peer_id.cmp(&right_peer.peer_id))
    });

    let mut urls = Vec::new();
    for (peer, _) in ranked.into_iter().take(fanout) {
        for base_url in &peer.base_urls {
            urls.push(format!(
                "{}/chunks/{}",
                base_url.trim_end_matches('/'),
                hash
            ));
        }
    }
    dedupe_urls(urls)
}

pub fn peer_url_fingerprint(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if !parsed.path().starts_with("/chunks/") {
        return None;
    }
    let host = parsed.host_str()?.to_ascii_lowercase();
    let port = parsed.port_or_known_default().unwrap_or(80);
    Some(format!("{host}:{port}"))
}

fn peer_to_candidate(peer: PeerOut) -> Option<PeerCandidate> {
    if peer.port == 0 {
        return None;
    }
    let mut base_urls = Vec::new();
    let mut best_scope = PeerScope::Other;

    for address in peer.addresses {
        if let Some(base_url) = address_to_base_url(&address, peer.port) {
            base_urls.push(base_url);
            let scope = classify_address_scope(&address);
            if scope < best_scope {
                best_scope = scope;
            }
        }
    }

    if base_urls.is_empty() {
        return None;
    }
    base_urls = dedupe_urls(base_urls);
    Some(PeerCandidate {
        peer_id: peer.peer_id,
        base_urls,
        upload_limit_bps: peer.upload_limit_bps,
        scope: best_scope,
    })
}

fn address_to_base_url(address: &str, port: u16) -> Option<String> {
    let trimmed = address.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let parsed = reqwest::Url::parse(trimmed).ok()?;
        let scheme = parsed.scheme();
        let host = parsed.host_str()?;
        let out_port = parsed.port().unwrap_or(port);
        return Some(format!("{}://{}:{}", scheme, host, out_port));
    }

    let ip = normalize_ip_literal(trimmed)?;
    match ip {
        IpAddr::V4(v4) => Some(format!("http://{}:{}", v4, port)),
        IpAddr::V6(v6) => Some(format!("http://[{}]:{}", v6, port)),
    }
}

fn normalize_ip_literal(value: &str) -> Option<IpAddr> {
    let cleaned = value.trim_matches(|ch| ch == '[' || ch == ']');
    cleaned.parse::<IpAddr>().ok()
}

fn classify_address_scope(address: &str) -> PeerScope {
    let Some(ip) = normalize_ip_literal(address) else {
        return PeerScope::Other;
    };
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_private() || v4.is_link_local() || v4.is_loopback() {
                return PeerScope::Lan;
            }
            if is_cgnat(v4) {
                return PeerScope::Vpn;
            }
            PeerScope::Other
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unicast_link_local() {
                return PeerScope::Lan;
            }
            if v6.is_unique_local() {
                return PeerScope::Vpn;
            }
            PeerScope::Other
        }
    }
}

fn dedupe_urls(items: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in items {
        let normalized = item.trim().to_string();
        if normalized.is_empty() {
            continue;
        }
        let key = normalized.to_ascii_lowercase();
        if seen.insert(key) {
            out.push(normalized);
        }
    }
    out
}

fn resolve_device_id() -> String {
    let from_env = std::env::var("OTOSHI_DEVICE_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(value) = from_env {
        return value;
    }

    let machine = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string());
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "unknown-user".to_string());
    let seed = format!("{machine}:{user}:otoshi-launcher");
    let digest = blake3::hash(seed.as_bytes());
    format!("pc-{}", &digest.to_hex()[..24])
}

fn is_cgnat(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

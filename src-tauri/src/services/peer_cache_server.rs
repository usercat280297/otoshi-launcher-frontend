use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PeerNetworkMode {
    LanOnly,
    LanVpn,
}

#[derive(Clone)]
pub struct PeerCacheServer {
    state: Arc<PeerCacheServerState>,
}

#[derive(Clone, Debug)]
pub struct PeerAdvertiseInfo {
    pub enabled: bool,
    pub share_enabled: bool,
    pub peer_id: String,
    pub port: u16,
    pub addresses: Vec<String>,
    pub upload_limit_bps: u64,
}

struct PeerCacheServerState {
    running: AtomicBool,
    mode: PeerNetworkMode,
    peer_id: String,
    port: u16,
    depot_root: PathBuf,
    share_enabled: bool,
    upload_limit_bps: AtomicU64,
    advertise_addresses: Vec<String>,
    limiter: UploadLimiter,
}

#[derive(Default)]
struct UploadLimiter {
    inner: Mutex<UploadWindow>,
}

struct UploadWindow {
    started_at: Instant,
    sent_bytes: u64,
}

#[derive(Serialize)]
struct HealthPayload {
    ok: bool,
    peer_id: String,
    version: &'static str,
}

impl Default for UploadWindow {
    fn default() -> Self {
        Self {
            started_at: Instant::now(),
            sent_bytes: 0,
        }
    }
}

impl UploadLimiter {
    fn wait_for_budget(&self, bytes: u64, max_bps: u64) {
        if max_bps == 0 || bytes == 0 {
            return;
        }
        loop {
            let sleep_for = {
                let mut guard = match self.inner.lock() {
                    Ok(locked) => locked,
                    Err(_) => return,
                };
                let elapsed = guard.started_at.elapsed();
                if elapsed >= Duration::from_secs(1) {
                    guard.started_at = Instant::now();
                    guard.sent_bytes = 0;
                }
                if guard.sent_bytes.saturating_add(bytes) <= max_bps {
                    guard.sent_bytes = guard.sent_bytes.saturating_add(bytes);
                    None
                } else {
                    Some(Duration::from_millis(25))
                }
            };
            if let Some(delay) = sleep_for {
                thread::sleep(delay);
                continue;
            }
            return;
        }
    }
}

impl PeerCacheServer {
    pub fn start(depot_root: PathBuf) -> Option<Self> {
        if !resolve_enabled_default_true() {
            return None;
        }

        let bind_host = std::env::var("OTOSHI_P2P_BIND")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "0.0.0.0".to_string());
        let preferred_port = std::env::var("OTOSHI_P2P_PORT")
            .ok()
            .and_then(|value| value.trim().parse::<u16>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(7942);

        let listener = TcpListener::bind((bind_host.as_str(), preferred_port))
            .or_else(|_| TcpListener::bind((bind_host.as_str(), 0)))
            .ok()?;
        let _ = listener.set_nonblocking(true);

        let bound_port = listener
            .local_addr()
            .map(|addr| addr.port())
            .unwrap_or(preferred_port);
        let mode = resolve_mode();
        let share_enabled = !env_falsey("OTOSHI_P2P_SHARE_ENABLED");
        let upload_limit_bps = std::env::var("OTOSHI_P2P_UPLOAD_LIMIT_BPS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(0);

        let mut advertise_addresses = resolve_advertise_addresses();
        if advertise_addresses.is_empty() {
            advertise_addresses.push("127.0.0.1".to_string());
        }
        advertise_addresses.sort();
        advertise_addresses.dedup();

        let state = Arc::new(PeerCacheServerState {
            running: AtomicBool::new(true),
            mode,
            peer_id: uuid::Uuid::new_v4().to_string(),
            port: bound_port,
            depot_root,
            share_enabled,
            upload_limit_bps: AtomicU64::new(upload_limit_bps),
            advertise_addresses,
            limiter: UploadLimiter::default(),
        });

        let server = Self {
            state: Arc::clone(&state),
        };
        thread::spawn(move || serve_loop(listener, state));
        Some(server)
    }

    pub fn advertise_info(&self) -> PeerAdvertiseInfo {
        PeerAdvertiseInfo {
            enabled: true,
            share_enabled: self.state.share_enabled,
            peer_id: self.state.peer_id.clone(),
            port: self.state.port,
            addresses: self.state.advertise_addresses.clone(),
            upload_limit_bps: self.state.upload_limit_bps.load(Ordering::Relaxed),
        }
    }

    pub fn upload_limit_bps(&self) -> u64 {
        self.state.upload_limit_bps.load(Ordering::Relaxed)
    }

    pub fn set_upload_limit_bps(&self, value: u64) {
        self.state.upload_limit_bps.store(value, Ordering::Relaxed);
    }

    pub fn peer_id(&self) -> &str {
        &self.state.peer_id
    }

    pub fn addresses(&self) -> &[String] {
        &self.state.advertise_addresses
    }
}

fn serve_loop(listener: TcpListener, state: Arc<PeerCacheServerState>) {
    let bound_port = listener.local_addr().map(|addr| addr.port()).unwrap_or(0);
    tracing::info!(
        "p2p peer cache server online peer_id={} port={} mode={:?}",
        state.peer_id,
        bound_port,
        state.mode
    );

    while state.running.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, remote_addr)) => {
                let state = Arc::clone(&state);
                thread::spawn(move || {
                    if let Err(err) = handle_connection(stream, remote_addr, &state) {
                        tracing::debug!("p2p connection error from {}: {}", remote_addr, err);
                    }
                });
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(err) => {
                tracing::warn!("p2p listener accept error: {}", err);
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    remote_addr: SocketAddr,
    state: &Arc<PeerCacheServerState>,
) -> std::io::Result<()> {
    if !is_allowed_remote(remote_addr.ip(), state.mode) {
        write_status(&mut stream, 403, "Forbidden", "peer access denied")?;
        return Ok(());
    }

    stream.set_read_timeout(Some(Duration::from_secs(4)))?;
    stream.set_write_timeout(Some(Duration::from_secs(12)))?;

    let request_line = match read_request_line(&stream)? {
        Some(value) => value,
        None => return Ok(()),
    };

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("/");
    let path = raw_path.split('?').next().unwrap_or("/");

    if method != "GET" {
        write_status(&mut stream, 405, "Method Not Allowed", "method not allowed")?;
        return Ok(());
    }

    if path == "/health" {
        let payload = HealthPayload {
            ok: true,
            peer_id: state.peer_id.clone(),
            version: env!("CARGO_PKG_VERSION"),
        };
        let body = serde_json::to_vec(&payload).unwrap_or_else(|_| br#"{"ok":true}"#.to_vec());
        write_json(&mut stream, 200, "OK", &body)?;
        return Ok(());
    }

    if let Some(hash) = path.strip_prefix("/chunks/") {
        if !is_valid_hash(hash) {
            write_status(&mut stream, 400, "Bad Request", "invalid chunk hash")?;
            return Ok(());
        }
        let normalized = hash.to_ascii_lowercase();
        let chunk_path = chunk_path_for_hash(&state.depot_root, &normalized);
        if !chunk_path.exists() {
            write_status(&mut stream, 404, "Not Found", "chunk not found")?;
            return Ok(());
        }
        let mut file = File::open(&chunk_path)?;
        let file_size = file.metadata().map(|meta| meta.len()).unwrap_or(0);
        write_binary_headers(&mut stream, file_size)?;

        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            let upload_limit = state.upload_limit_bps.load(Ordering::Relaxed);
            state.limiter.wait_for_budget(read as u64, upload_limit);
            stream.write_all(&buffer[..read])?;
        }
        let _ = stream.flush();
        return Ok(());
    }

    write_status(&mut stream, 404, "Not Found", "unknown endpoint")?;
    Ok(())
}

fn read_request_line(stream: &TcpStream) -> std::io::Result<Option<String>> {
    let clone = stream.try_clone()?;
    let mut reader = BufReader::new(clone);
    let mut first_line = String::new();
    let bytes = reader.read_line(&mut first_line)?;
    if bytes == 0 {
        return Ok(None);
    }

    for _ in 0..64 {
        let mut line = String::new();
        let count = reader.read_line(&mut line)?;
        if count == 0 {
            break;
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
    }
    Ok(Some(first_line))
}

fn write_status(
    stream: &mut TcpStream,
    code: u16,
    status: &str,
    message: &str,
) -> std::io::Result<()> {
    let body = message.as_bytes();
    let response = format!(
        "HTTP/1.1 {code} {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(response.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn write_json(stream: &mut TcpStream, code: u16, status: &str, body: &[u8]) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 {code} {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(response.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn write_binary_headers(stream: &mut TcpStream, content_length: u64) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {content_length}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(response.as_bytes())
}

fn chunk_path_for_hash(root: &Path, hash: &str) -> PathBuf {
    let prefix = &hash[..2];
    root.join(prefix).join(format!("{hash}.bin"))
}

fn is_valid_hash(value: &str) -> bool {
    if value.len() != 64 {
        return false;
    }
    value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn resolve_mode() -> PeerNetworkMode {
    let value = std::env::var("OTOSHI_P2P_MODE")
        .ok()
        .unwrap_or_else(|| "lan_only".to_string());
    if value.trim().eq_ignore_ascii_case("lan_vpn") {
        PeerNetworkMode::LanVpn
    } else {
        PeerNetworkMode::LanOnly
    }
}

fn resolve_advertise_addresses() -> Vec<String> {
    let mut addresses = std::env::var("OTOSHI_P2P_ADVERTISE_ADDRS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(|entry| entry.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        let _ = socket.connect("1.1.1.1:80");
        if let Ok(local) = socket.local_addr() {
            addresses.push(local.ip().to_string());
        }
    }

    addresses
}

fn is_allowed_remote(ip: IpAddr, mode: PeerNetworkMode) -> bool {
    if ip.is_loopback() {
        return true;
    }
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_private() || v4.is_link_local() {
                return true;
            }
            if mode == PeerNetworkMode::LanVpn && is_cgnat(v4) {
                return true;
            }
            false
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unique_local() || v6.is_unicast_link_local() {
                return true;
            }
            mode == PeerNetworkMode::LanVpn && v6.is_unique_local()
        }
    }
}

fn is_cgnat(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn resolve_enabled_default_true() -> bool {
    let p2p_enabled = env_bool("P2P_ENABLED");
    let otoshi_enabled = env_bool("OTOSHI_P2P_ENABLED");
    otoshi_enabled.or(p2p_enabled).unwrap_or(true)
}

fn env_bool(key: &str) -> Option<bool> {
    let value = std::env::var(key).ok()?;
    let normalized = value.trim().to_ascii_lowercase();
    if matches!(normalized.as_str(), "1" | "true" | "yes" | "on") {
        return Some(true);
    }
    if matches!(normalized.as_str(), "0" | "false" | "no" | "off") {
        return Some(false);
    }
    None
}

fn env_falsey(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "0" | "false" | "no" | "off")
        })
        .unwrap_or(false)
}

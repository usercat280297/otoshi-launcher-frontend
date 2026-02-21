use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use image::{ExtendedColorType, GenericImageView};
use rand::rngs::OsRng;
use rand::RngCore;
use reqwest::Client;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sysinfo::System;

use crate::errors::{LauncherError, Result};

const CACHE_MAGIC: &[u8; 6] = b"OTART2";
const CACHE_VERSION: u8 = 2;
const LEGACY_MAGIC: &[u8; 6] = b"OTART1";
const NONCE_LEN: usize = 12;
const LEGACY_VERSION: u8 = 1;
const DEFAULT_RAM_LRU_MAX_ENTRIES: usize = 160;
const DEFAULT_RAM_LRU_MAX_BYTES: usize = 48 * 1024 * 1024;

#[derive(Clone, Debug, Default)]
pub struct ArtworkSources {
    pub t0: Option<String>,
    pub t1: Option<String>,
    pub t2: Option<String>,
    pub t3: Option<String>,
    pub t4: Option<String>,
}

impl ArtworkSources {
    fn normalized_tier(&self, tier: i32) -> Option<String> {
        let all = [
            self.t0.clone(),
            self.t1.clone(),
            self.t2.clone(),
            self.t3.clone(),
            self.t4.clone(),
        ];
        let idx = tier.clamp(0, 4) as usize;
        all.get(idx)
            .and_then(|value| value.clone())
            .or_else(|| all.iter().rev().find_map(|value| value.clone()))
    }
}

#[derive(Clone, Debug)]
pub struct ArtworkPrefetchItem {
    pub game_id: String,
    pub sources: ArtworkSources,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ArtworkCacheMetrics {
    pub memory_hits: u64,
    pub disk_hits: u64,
    pub misses: u64,
    pub migrations: u64,
    pub encrypted_writes: u64,
    pub decode_ms: u64,
    pub upload_ms: u64,
}

#[derive(Default)]
struct RamLru {
    max_entries: usize,
    max_bytes: usize,
    total_bytes: usize,
    order: VecDeque<String>,
    values: HashMap<String, String>,
}

impl RamLru {
    fn new(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            max_entries: max_entries.max(8),
            max_bytes: max_bytes.max(4 * 1024 * 1024),
            ..Self::default()
        }
    }

    fn get(&mut self, key: &str) -> Option<String> {
        if let Some(value) = self.values.get(key).cloned() {
            self.touch(key);
            return Some(value);
        }
        None
    }

    fn insert(&mut self, key: String, value: String) {
        if let Some(existing) = self.values.insert(key.clone(), value.clone()) {
            self.total_bytes = self.total_bytes.saturating_sub(existing.len());
        }
        self.total_bytes = self.total_bytes.saturating_add(value.len());
        self.touch(&key);
        self.evict_if_needed();
    }

    fn remove_prefix(&mut self, prefix: &str) {
        let keys: Vec<String> = self
            .values
            .keys()
            .filter(|key| key.starts_with(prefix))
            .cloned()
            .collect();
        for key in keys {
            if let Some(value) = self.values.remove(&key) {
                self.total_bytes = self.total_bytes.saturating_sub(value.len());
            }
            self.order.retain(|candidate| candidate != &key);
        }
    }

    fn touch(&mut self, key: &str) {
        self.order.retain(|entry| entry != key);
        self.order.push_front(key.to_string());
    }

    fn evict_if_needed(&mut self) {
        while self.values.len() > self.max_entries || self.total_bytes > self.max_bytes {
            let Some(oldest) = self.order.pop_back() else {
                break;
            };
            if let Some(removed) = self.values.remove(&oldest) {
                self.total_bytes = self.total_bytes.saturating_sub(removed.len());
            }
        }
    }
}

#[derive(Clone)]
pub struct ArtworkCacheService {
    cache_root: PathBuf,
    legacy_root: PathBuf,
    key_bytes: Arc<[u8; 32]>,
    client: Client,
    lru: Arc<Mutex<RamLru>>,
    metrics: Arc<Mutex<ArtworkCacheMetrics>>,
}

impl ArtworkCacheService {
    pub fn new(cache_dir: PathBuf, install_key: &[u8]) -> Result<Self> {
        let cache_root = cache_dir.join("artwork_cache_v2");
        let legacy_root = cache_dir.join("artwork_cache");
        fs::create_dir_all(&cache_root)?;
        fs::create_dir_all(&legacy_root)?;

        let machine = machine_fingerprint();
        let mut hasher = Sha256::new();
        hasher.update(install_key);
        hasher.update(machine.as_bytes());
        let digest = hasher.finalize();
        let mut key_bytes = [0_u8; 32];
        key_bytes.copy_from_slice(&digest[..32]);

        let max_entries = std::env::var("ARTWORK_RAM_LRU_MAX_ENTRIES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(DEFAULT_RAM_LRU_MAX_ENTRIES);
        let max_bytes = std::env::var("ARTWORK_RAM_LRU_MAX_BYTES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(DEFAULT_RAM_LRU_MAX_BYTES);

        let client = Client::builder()
            .timeout(Duration::from_secs(16))
            .build()
            .map_err(LauncherError::Network)?;

        Ok(Self {
            cache_root,
            legacy_root,
            key_bytes: Arc::new(key_bytes),
            client,
            lru: Arc::new(Mutex::new(RamLru::new(max_entries, max_bytes))),
            metrics: Arc::new(Mutex::new(ArtworkCacheMetrics::default())),
        })
    }

    pub fn metrics_snapshot(&self) -> ArtworkCacheMetrics {
        self.metrics
            .lock()
            .map(|metrics| metrics.clone())
            .unwrap_or_default()
    }

    pub async fn get_data_url(
        &self,
        game_id: &str,
        tier: i32,
        dpi: i32,
        sources: Option<&ArtworkSources>,
    ) -> Result<Option<String>> {
        let normalized_tier = tier.clamp(0, 4);
        let normalized_dpi = dpi.clamp(1, 4);
        let source_url = sources
            .and_then(|value| value.normalized_tier(normalized_tier))
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let cache_key = source_url
            .as_ref()
            .map(|url| {
                format!(
                    "{}:{}:{}:{}",
                    game_id,
                    normalized_tier,
                    normalized_dpi,
                    source_fingerprint(url)
                )
            })
            .unwrap_or_else(|| format!("{}:{}:{}", game_id, normalized_tier, normalized_dpi));

        if let Some(value) = self.lru.lock().ok().and_then(|mut lru| lru.get(&cache_key)) {
            self.bump_metric(|metrics| metrics.memory_hits = metrics.memory_hits.saturating_add(1));
            return Ok(Some(value));
        }

        if let Some(payload) = self.read_v2_payload(&cache_key)? {
            let data_url = bytes_to_data_url(&payload);
            self.store_lru(&cache_key, data_url.clone());
            self.bump_metric(|metrics| metrics.disk_hits = metrics.disk_hits.saturating_add(1));
            return Ok(Some(data_url));
        }

        if let Some(payload) = self.try_lazy_migrate(game_id, normalized_tier, normalized_dpi, &cache_key)? {
            let data_url = bytes_to_data_url(&payload);
            self.store_lru(&cache_key, data_url.clone());
            self.bump_metric(|metrics| metrics.migrations = metrics.migrations.saturating_add(1));
            return Ok(Some(data_url));
        }

        let Some(source_url) = source_url else {
            self.bump_metric(|metrics| metrics.misses = metrics.misses.saturating_add(1));
            return Ok(None);
        };

        let downloaded_at = Instant::now();
        let response = self
            .client
            .get(source_url)
            .send()
            .await
            .map_err(LauncherError::Network)?;
        if !response.status().is_success() {
            self.bump_metric(|metrics| metrics.misses = metrics.misses.saturating_add(1));
            return Ok(None);
        }
        let raw = response
            .bytes()
            .await
            .map_err(LauncherError::Network)?
            .to_vec();
        let upload_elapsed = downloaded_at.elapsed().as_millis() as u64;
        self.bump_metric(|metrics| metrics.upload_ms = metrics.upload_ms.saturating_add(upload_elapsed));

        let decode_start = Instant::now();
        let tier_copy = normalized_tier;
        let dpi_copy = normalized_dpi;
        let converted = tokio::task::spawn_blocking(move || convert_to_tiered_webp(raw, tier_copy, dpi_copy))
            .await
            .map_err(|err| LauncherError::Config(format!("artwork decode task join failed: {}", err)))??;
        let decode_elapsed = decode_start.elapsed().as_millis() as u64;
        self.bump_metric(|metrics| metrics.decode_ms = metrics.decode_ms.saturating_add(decode_elapsed));

        self.write_v2_payload(&cache_key, &converted)?;
        self.bump_metric(|metrics| metrics.encrypted_writes = metrics.encrypted_writes.saturating_add(1));
        let data_url = bytes_to_data_url(&converted);
        self.store_lru(&cache_key, data_url.clone());
        Ok(Some(data_url))
    }

    pub async fn prefetch(
        &self,
        items: Vec<ArtworkPrefetchItem>,
        tier_hint: i32,
    ) -> Result<usize> {
        let mut warmed = 0_usize;
        for item in items {
            let value = self
                .get_data_url(&item.game_id, tier_hint, 1, Some(&item.sources))
                .await?;
            if value.is_some() {
                warmed += 1;
            }
        }
        Ok(warmed)
    }

    pub fn release(&self, game_id: &str) -> Result<()> {
        let prefix = format!("{}:", game_id);
        if let Ok(mut lru) = self.lru.lock() {
            lru.remove_prefix(&prefix);
        }

        for tier in 0..=4_i32 {
            for dpi in 1..=4_i32 {
                let key = format!("{}:{}:{}", game_id, tier, dpi);
                let path = self.v2_path_for_key(&key);
                if path.exists() {
                    let _ = fs::remove_file(path);
                }
            }
        }

        let legacy_dir = self.legacy_root.join(game_id);
        if legacy_dir.exists() {
            let _ = fs::remove_dir_all(legacy_dir);
        }
        Ok(())
    }

    fn store_lru(&self, key: &str, value: String) {
        if let Ok(mut lru) = self.lru.lock() {
            lru.insert(key.to_string(), value);
        }
    }

    fn bump_metric<F>(&self, mut update: F)
    where
        F: FnMut(&mut ArtworkCacheMetrics),
    {
        if let Ok(mut metrics) = self.metrics.lock() {
            update(&mut metrics);
        }
    }

    fn read_v2_payload(&self, cache_key: &str) -> Result<Option<Vec<u8>>> {
        let path = self.v2_path_for_key(cache_key);
        if !path.exists() {
            return Ok(None);
        }
        let mut file = fs::File::open(path)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;
        if data.len() <= CACHE_MAGIC.len() + 1 + NONCE_LEN {
            return Ok(None);
        }
        if &data[0..CACHE_MAGIC.len()] != CACHE_MAGIC {
            return Ok(None);
        }
        let version = data[CACHE_MAGIC.len()];
        if version != CACHE_VERSION {
            return Ok(None);
        }
        let nonce_start = CACHE_MAGIC.len() + 1;
        let nonce_end = nonce_start + NONCE_LEN;
        let nonce = Nonce::from_slice(&data[nonce_start..nonce_end]);
        let ciphertext = &data[nonce_end..];
        let cipher_key = Key::<Aes256Gcm>::from_slice(self.key_bytes.as_slice());
        let cipher = Aes256Gcm::new(cipher_key);
        let payload = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| LauncherError::Crypto("artwork cache decryption failed".to_string()))?;
        Ok(Some(payload))
    }

    fn write_v2_payload(&self, cache_key: &str, payload: &[u8]) -> Result<()> {
        let path = self.v2_path_for_key(cache_key);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut nonce = [0_u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce);

        let cipher_key = Key::<Aes256Gcm>::from_slice(self.key_bytes.as_slice());
        let cipher = Aes256Gcm::new(cipher_key);
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce), payload)
            .map_err(|_| LauncherError::Crypto("artwork cache encryption failed".to_string()))?;

        let mut output = Vec::with_capacity(CACHE_MAGIC.len() + 1 + NONCE_LEN + ciphertext.len());
        output.extend_from_slice(CACHE_MAGIC);
        output.push(CACHE_VERSION);
        output.extend_from_slice(&nonce);
        output.extend_from_slice(&ciphertext);
        let mut file = fs::File::create(path)?;
        file.write_all(&output)?;
        Ok(())
    }

    fn try_lazy_migrate(
        &self,
        game_id: &str,
        tier: i32,
        dpi: i32,
        cache_key: &str,
    ) -> Result<Option<Vec<u8>>> {
        let legacy_path = self
            .legacy_root
            .join(game_id)
            .join(format!("t{}_{}.webp", tier.max(0), dpi.max(1)));
        if !legacy_path.exists() {
            return Ok(None);
        }
        let legacy_payload = fs::read(&legacy_path)?;
        if legacy_payload.is_empty() {
            let _ = fs::remove_file(&legacy_path);
            return Ok(None);
        }
        let Some(payload) = self.decode_legacy_payload(&legacy_payload)? else {
            let _ = fs::remove_file(&legacy_path);
            return Ok(None);
        };
        self.write_v2_payload(cache_key, &payload)?;
        let _ = fs::remove_file(legacy_path);
        Ok(Some(payload))
    }

    fn decode_legacy_payload(&self, payload: &[u8]) -> Result<Option<Vec<u8>>> {
        let minimum_size = LEGACY_MAGIC.len() + 1 + NONCE_LEN;
        if payload.len() <= minimum_size {
            return Ok(Some(payload.to_vec()));
        }

        if &payload[..LEGACY_MAGIC.len()] != LEGACY_MAGIC {
            return Ok(Some(payload.to_vec()));
        }

        let version = payload[LEGACY_MAGIC.len()];
        if version != LEGACY_VERSION {
            return Ok(None);
        }

        let nonce_start = LEGACY_MAGIC.len() + 1;
        let nonce_end = nonce_start + NONCE_LEN;
        let nonce = Nonce::from_slice(&payload[nonce_start..nonce_end]);
        let ciphertext = &payload[nonce_end..];
        let cipher_key = Key::<Aes256Gcm>::from_slice(self.key_bytes.as_slice());
        let cipher = Aes256Gcm::new(cipher_key);
        let decrypted = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| LauncherError::Crypto("legacy artwork cache decryption failed".to_string()))?;
        Ok(Some(decrypted))
    }

    fn v2_path_for_key(&self, cache_key: &str) -> PathBuf {
        let digest = blake3::keyed_hash(self.key_bytes.as_ref(), cache_key.as_bytes());
        let hex = digest.to_hex().to_string();
        self.cache_root.join(format!("{}.bin", hex))
    }
}

fn machine_fingerprint() -> String {
    let mut system = System::new_all();
    system.refresh_all();

    let mut parts = vec![
        System::name().unwrap_or_default(),
        System::kernel_version().unwrap_or_default(),
        System::host_name().unwrap_or_default(),
    ];
    if let Some(cpu) = system.cpus().first() {
        parts.push(cpu.brand().to_string());
    }
    parts.retain(|value| !value.is_empty());

    if parts.is_empty() {
        return "unknown-machine".to_string();
    }
    parts.join("|")
}

fn source_fingerprint(source_url: &str) -> String {
    let digest = blake3::hash(source_url.as_bytes());
    digest.to_hex().to_string()
}

fn tier_width(tier: i32, dpi: i32) -> u32 {
    let base = match tier.clamp(0, 4) {
        0 => 96,
        1 => 160,
        2 => 280,
        3 => 460,
        _ => 720,
    };
    let scale = dpi.clamp(1, 4) as u32;
    (base as u32).saturating_mul(scale)
}

fn convert_to_tiered_webp(raw: Vec<u8>, tier: i32, dpi: i32) -> Result<Vec<u8>> {
    let image = image::load_from_memory(&raw)
        .map_err(|err| LauncherError::Config(format!("artwork decode failed: {}", err)))?;
    let (current_w, current_h) = image.dimensions();
    let target_w = tier_width(tier, dpi).max(64);
    let resized = if current_w > target_w {
        let ratio = current_h as f32 / current_w as f32;
        let target_h = ((target_w as f32) * ratio).max(64.0) as u32;
        image.resize(target_w, target_h, FilterType::Triangle)
    } else {
        image
    };

    let rgba = resized.to_rgba8();
    let mut encoded = Vec::new();
    let encoder = WebPEncoder::new_lossless(&mut encoded);
    encoder
        .encode(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            ExtendedColorType::Rgba8,
        )
        .map_err(|err| LauncherError::Config(format!("artwork encode failed: {}", err)))?;

    if encoded.is_empty() {
        return Err(LauncherError::Config(
            "artwork encode produced empty payload".to_string(),
        ));
    }
    Ok(encoded)
}

fn bytes_to_data_url(payload: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(payload);
    format!("data:image/webp;base64,{}", encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use uuid::Uuid;

    fn temp_cache_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("otoshi-artwork-cache-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp cache directory");
        dir
    }

    fn sample_webp_payload() -> Vec<u8> {
        let image = RgbaImage::from_pixel(12, 12, Rgba([100, 180, 220, 255]));
        let mut encoded = Vec::new();
        let encoder = WebPEncoder::new_lossless(&mut encoded);
        encoder
            .encode(
                image.as_raw(),
                image.width(),
                image.height(),
                ExtendedColorType::Rgba8,
            )
            .expect("encode test webp");
        encoded
    }

    fn decode_data_url(url: &str) -> Vec<u8> {
        let prefix = "data:image/webp;base64,";
        let encoded = url
            .strip_prefix(prefix)
            .expect("data url should contain webp base64 prefix");
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("decode base64 payload")
    }

    #[tokio::test]
    async fn migrates_legacy_plaintext_v1_on_access() {
        let cache_root = temp_cache_dir();
        let service = ArtworkCacheService::new(cache_root.clone(), b"test-install-key")
            .expect("create artwork service");

        let game_id = "legacy_plain";
        let cache_key = format!("{}:{}:{}", game_id, 1, 1);
        let legacy_path = cache_root
            .join("artwork_cache")
            .join(game_id)
            .join("t1_1.webp");
        std::fs::create_dir_all(legacy_path.parent().expect("legacy parent"))
            .expect("create legacy parent");
        let legacy_payload = sample_webp_payload();
        std::fs::write(&legacy_path, &legacy_payload).expect("write legacy payload");

        let loaded = service
            .get_data_url(game_id, 1, 1, None)
            .await
            .expect("load migrated payload")
            .expect("payload should exist");
        let migrated_payload = decode_data_url(&loaded);

        assert_eq!(migrated_payload, legacy_payload);
        assert!(!legacy_path.exists(), "legacy payload must be removed after migrate");
        assert!(service.v2_path_for_key(&cache_key).exists(), "v2 payload must be created");

        let loaded_from_v2 = service
            .get_data_url(game_id, 1, 1, None)
            .await
            .expect("load payload from v2")
            .expect("v2 payload should exist");
        assert_eq!(decode_data_url(&loaded_from_v2), legacy_payload);
    }

    #[tokio::test]
    async fn migrates_legacy_encrypted_v1_on_access() {
        let cache_root = temp_cache_dir();
        let service = ArtworkCacheService::new(cache_root.clone(), b"test-install-key-encrypted")
            .expect("create artwork service");

        let game_id = "legacy_encrypted";
        let cache_key = format!("{}:{}:{}", game_id, 2, 1);
        let legacy_path = cache_root
            .join("artwork_cache")
            .join(game_id)
            .join("t2_1.webp");
        std::fs::create_dir_all(legacy_path.parent().expect("legacy parent"))
            .expect("create legacy parent");

        let plaintext = sample_webp_payload();
        let mut nonce = [0_u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce);
        let cipher_key = Key::<Aes256Gcm>::from_slice(service.key_bytes.as_slice());
        let cipher = Aes256Gcm::new(cipher_key);
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_slice())
            .expect("encrypt legacy v1 payload");

        let mut legacy_v1 = Vec::with_capacity(LEGACY_MAGIC.len() + 1 + NONCE_LEN + ciphertext.len());
        legacy_v1.extend_from_slice(LEGACY_MAGIC);
        legacy_v1.push(LEGACY_VERSION);
        legacy_v1.extend_from_slice(&nonce);
        legacy_v1.extend_from_slice(&ciphertext);
        std::fs::write(&legacy_path, &legacy_v1).expect("write encrypted legacy payload");

        let loaded = service
            .get_data_url(game_id, 2, 1, None)
            .await
            .expect("load migrated payload")
            .expect("payload should exist");
        let migrated_payload = decode_data_url(&loaded);

        assert_eq!(migrated_payload, plaintext);
        assert!(!legacy_path.exists(), "encrypted legacy payload must be removed");
        assert!(service.v2_path_for_key(&cache_key).exists(), "v2 payload must be written");
    }
}

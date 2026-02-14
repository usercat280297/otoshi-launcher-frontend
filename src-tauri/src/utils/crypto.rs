use std::fs;
use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;

use crate::errors::{LauncherError, Result};

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

pub fn load_or_create_key(path: &Path) -> Result<Vec<u8>> {
    if path.exists() {
        let data = fs::read(path)?;
        if data.len() != KEY_LEN {
            return Err(LauncherError::Crypto("invalid key length".to_string()));
        }
        return Ok(data);
    }

    let mut key = vec![0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    fs::write(path, &key)?;
    Ok(key)
}

pub fn encrypt_to_base64(key_bytes: &[u8], plaintext: &[u8]) -> Result<String> {
    if key_bytes.len() != KEY_LEN {
        return Err(LauncherError::Crypto("invalid key length".to_string()));
    }
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| LauncherError::Crypto("encryption failed".to_string()))?;

    let mut output = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    Ok(base64::engine::general_purpose::STANDARD.encode(output))
}

pub fn decrypt_from_base64(key_bytes: &[u8], payload: &str) -> Result<Vec<u8>> {
    if key_bytes.len() != KEY_LEN {
        return Err(LauncherError::Crypto("invalid key length".to_string()));
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|_| LauncherError::Crypto("invalid base64 payload".to_string()))?;

    if decoded.len() <= NONCE_LEN {
        return Err(LauncherError::Crypto("payload too small".to_string()));
    }

    let (nonce_bytes, ciphertext) = decoded.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| LauncherError::Crypto("decryption failed".to_string()))
}

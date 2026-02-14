use base64::Engine;
use chrono::{DateTime, Utc};
use rsa::pkcs1v15::{Signature, VerifyingKey};
use rsa::pkcs8::DecodePublicKey;
use rsa::signature::Verifier;
use rsa::RsaPublicKey;
use sha2::{Digest, Sha256};
use sysinfo::System;

use crate::errors::{LauncherError, Result};
use crate::models::LicenseInfo;

const DEFAULT_PUBLIC_KEY: &str = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Wf13/yMzpLYcdCa2QKk\n00wf0ehHks1iOtdFcK4ErkF38sESIIpteFqNvSYGImO4YE2N1nGiAnzQYlza4Gnt\niEQm9Smdi8ePlu4gwBOOGJLiBFMS9QNW3KXZ4+lNsYETuY9MGrzdEjiMsk+87fAZ\nhdIDCT9ojkFMeUQGRl/r5HK5FB3eUs6OkUJA1GK60NTsjsPljRye1xxGnMm29K6S\neMGf42ICyA08hEcwtk/goDst9LM/l92IXrPxVjzT7OCeKiQiLTHfW74Hgh6vHFlo\nhkYAs0dEEcs0tmAtqBTKThDC+VHZkFA2wLWJtr6q11d1JxJxkG+EyyHynso3UM+0\nOQIDAQAB\n-----END PUBLIC KEY-----";

#[derive(Clone)]
pub struct LicenseService {
    public_key_pem: String,
}

impl LicenseService {
    pub fn new(public_key_pem: Option<String>) -> Self {
        let pem = public_key_pem.unwrap_or_else(|| DEFAULT_PUBLIC_KEY.to_string());
        Self {
            public_key_pem: pem,
        }
    }

    pub fn get_hardware_id(&self) -> String {
        let mut sys = System::new_all();
        sys.refresh_all();

        let mut parts: Vec<String> = vec![
            System::name().unwrap_or_default(),
            System::kernel_version().unwrap_or_default(),
            System::host_name().unwrap_or_default(),
        ];
        if let Some(cpu) = sys.cpus().first() {
            parts.push(cpu.brand().to_string());
        }

        parts.retain(|item| !item.is_empty());
        let payload = parts.join("|");

        let mut hasher = Sha256::new();
        hasher.update(payload.as_bytes());
        hex::encode(hasher.finalize())
    }

    pub fn validate_license(&self, license_json: &str) -> Result<LicenseInfo> {
        let license: LicenseInfo = serde_json::from_str(license_json)?;
        self.verify_signature(&license)?;
        self.verify_expiration(&license)?;
        self.verify_activation(&license)?;
        self.verify_hardware(&license)?;
        Ok(license)
    }

    fn verify_signature(&self, license: &LicenseInfo) -> Result<()> {
        let payload = license.signing_payload();
        let public_key = RsaPublicKey::from_public_key_pem(&self.public_key_pem)
            .map_err(|err| LauncherError::Crypto(err.to_string()))?;
        let verifying_key = VerifyingKey::<Sha256>::new_unprefixed(public_key);
        let signature_bytes = base64::engine::general_purpose::STANDARD
            .decode(&license.signature)
            .map_err(|err| LauncherError::Crypto(err.to_string()))?;
        let signature = Signature::try_from(signature_bytes.as_slice())
            .map_err(|_| LauncherError::Crypto("invalid signature".to_string()))?;
        verifying_key
            .verify(payload.as_bytes(), &signature)
            .map_err(|err| LauncherError::Crypto(err.to_string()))?;
        Ok(())
    }

    fn verify_expiration(&self, license: &LicenseInfo) -> Result<()> {
        if let Some(expires_at) = &license.expires_at {
            let parsed = DateTime::parse_from_rfc3339(expires_at)
                .map_err(|err| LauncherError::Crypto(err.to_string()))?;
            if parsed.with_timezone(&Utc) < Utc::now() {
                return Err(LauncherError::Crypto("license expired".to_string()));
            }
        }
        Ok(())
    }

    fn verify_activation(&self, license: &LicenseInfo) -> Result<()> {
        if license.current_activations >= license.max_activations {
            return Err(LauncherError::Crypto(
                "maximum activations reached".to_string(),
            ));
        }
        Ok(())
    }

    fn verify_hardware(&self, license: &LicenseInfo) -> Result<()> {
        if let Some(hardware_id) = &license.hardware_id {
            let local = self.get_hardware_id();
            if local != *hardware_id {
                return Err(LauncherError::Crypto("hardware mismatch".to_string()));
            }
        }
        Ok(())
    }
}

//! Authenticated local encryption; the per-user master key lives in macOS Keychain.
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use std::sync::{Mutex, OnceLock};

const MAGIC: &[u8] = b"WTM1";

fn master_key(create: bool) -> Result<[u8; 32], String> {
    static CACHE: OnceLock<[u8; 32]> = OnceLock::new();
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    if let Some(key) = CACHE.get() {
        return Ok(*key);
    }
    let entry = keyring::Entry::new("app.withtype.desktop", "local-data-key-v1")
        .map_err(|e| format!("无法打开 macOS 钥匙串：{e}"))?;
    let key = match entry.get_secret() {
        Ok(bytes) => bytes.try_into().map_err(|_| "本机加密密钥格式无效")?,
        Err(keyring::Error::NoEntry) if create => {
            let mut bytes = [0; 32];
            SystemRandom::new()
                .fill(&mut bytes)
                .map_err(|_| "无法生成本机加密密钥")?;
            entry
                .set_secret(&bytes)
                .map_err(|e| format!("无法保存 macOS 加密密钥：{e}"))?;
            bytes
        }
        Err(e) => return Err(format!("无法读取 macOS 加密密钥：{e}")),
    };
    let _ = CACHE.set(key);
    Ok(key)
}

fn seal(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, key).map_err(|_| "加密初始化失败")?;
    let key = aead::LessSafeKey::new(key);
    let mut nonce = [0; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "加密随机数生成失败")?;
    let mut cipher = plain.to_vec();
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(MAGIC),
        &mut cipher,
    )
    .map_err(|_| "本机数据加密失败")?;
    let mut data = MAGIC.to_vec();
    data.extend_from_slice(&nonce);
    data.extend_from_slice(&cipher);
    Ok(data)
}

fn open(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < MAGIC.len() + 12 + 16 || !data.starts_with(MAGIC) {
        return Err("本机加密数据格式无效".into());
    }
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, key).map_err(|_| "解密初始化失败")?;
    let key = aead::LessSafeKey::new(key);
    let nonce: [u8; 12] = data[4..16].try_into().map_err(|_| "无效随机数")?;
    let mut cipher = data[16..].to_vec();
    key.open_in_place(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(MAGIC),
        &mut cipher,
    )
    .map(|plain| plain.to_vec())
    .map_err(|_| "数据解密失败：密钥不匹配或文件已损坏".into())
}

pub(crate) fn protect_data(plain: &[u8]) -> Result<Vec<u8>, String> {
    seal(&master_key(true)?, plain)
}
pub(crate) fn unprotect_data(cipher: &[u8]) -> Result<Vec<u8>, String> {
    open(&master_key(false)?, cipher)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_data_roundtrips_with_unique_nonces() {
        let key = [7; 32];
        let a = seal(&key, "语音记录🙂".as_bytes()).unwrap();
        let b = seal(&key, "语音记录🙂".as_bytes()).unwrap();
        assert_ne!(a, b);
        assert_eq!(open(&key, &a).unwrap(), "语音记录🙂".as_bytes());
    }
    #[test]
    fn changed_data_and_wrong_keys_are_rejected() {
        let mut data = seal(&[1; 32], b"private").unwrap();
        assert!(open(&[2; 32], &data).is_err());
        data[16] ^= 1;
        assert!(open(&[1; 32], &data).is_err());
        assert!(open(&[1; 32], b"invalid").is_err());
    }
}

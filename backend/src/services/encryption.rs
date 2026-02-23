use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use anyhow::{Context, Result};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;

/// Dérive une clé de chiffrement spécifique au tenant à partir de la clé maître
/// 
/// # Arguments
/// * `master_key` - Clé maître (32 bytes)
/// * `tenant` - Nom du tenant pour la dérivation
pub fn derive_tenant_key(master_key: &[u8], tenant: &str) -> Result<[u8; 32]> {
    if master_key.len() != 32 {
        anyhow::bail!("Master key must be exactly 32 bytes");
    }

    let hk = Hkdf::<Sha256>::new(None, master_key);
    let info = format!("minispace-tenant-{}", tenant);
    let mut tenant_key = [0u8; 32];
    hk.expand(info.as_bytes(), &mut tenant_key)
        .map_err(|_| anyhow::anyhow!("Failed to derive tenant key"))?;

    Ok(tenant_key)
}

/// Chiffre des données avec AES-256-GCM
/// 
/// # Arguments
/// * `plaintext` - Données à chiffrer
/// * `key` - Clé de chiffrement (32 bytes)
/// 
/// # Returns
/// Tuple (ciphertext, iv, authentication_tag)
pub fn encrypt_file(plaintext: &[u8], key: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>)> {
    // Créer le cipher AES-256-GCM
    let cipher = Aes256Gcm::new_from_slice(key)
        .context("Failed to create cipher")?;

    // Générer un IV aléatoire de 12 bytes (96 bits, recommandé pour GCM)
    let mut iv = vec![0u8; 12];
    OsRng.fill_bytes(&mut iv);

    let nonce = Nonce::from_slice(&iv);

    // Chiffrer les données - le tag d'authentification est inclus dans le ciphertext
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    // En AES-GCM, les 16 derniers bytes du ciphertext sont le tag d'authentification
    let tag_start = ciphertext.len().saturating_sub(16);
    let encrypted_data = ciphertext[..tag_start].to_vec();
    let tag = ciphertext[tag_start..].to_vec();

    Ok((encrypted_data, iv, tag))
}

/// Déchiffre des données chiffrées avec AES-256-GCM
/// 
/// # Arguments
/// * `ciphertext` - Données chiffrées
/// * `iv` - Vecteur d'initialisation (12 bytes)
/// * `tag` - Tag d'authentification (16 bytes)
/// * `key` - Clé de déchiffrement (32 bytes)
/// 
/// # Returns
/// Données déchiffrées
pub fn decrypt_file(ciphertext: &[u8], iv: &[u8], tag: &[u8], key: &[u8; 32]) -> Result<Vec<u8>> {
    if iv.len() != 12 {
        anyhow::bail!("IV must be exactly 12 bytes");
    }
    if tag.len() != 16 {
        anyhow::bail!("Authentication tag must be exactly 16 bytes");
    }

    // Créer le cipher AES-256-GCM
    let cipher = Aes256Gcm::new_from_slice(key)
        .context("Failed to create cipher")?;

    let nonce = Nonce::from_slice(iv);

    // Recombiner ciphertext + tag pour aes-gcm
    let mut combined = ciphertext.to_vec();
    combined.extend_from_slice(tag);

    // Déchiffrer et vérifier l'authenticité
    let plaintext = cipher
        .decrypt(nonce, combined.as_ref())
        .map_err(|e| anyhow::anyhow!("Decryption failed (data may be corrupted or tampered): {}", e))?;

    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_tenant_key() {
        let master_key = [0u8; 32];
        let key1 = derive_tenant_key(&master_key, "tenant1").unwrap();
        let key2 = derive_tenant_key(&master_key, "tenant2").unwrap();
        let key1_again = derive_tenant_key(&master_key, "tenant1").unwrap();

        // Les clés doivent être déterministes
        assert_eq!(key1, key1_again);
        // Les clés de différents tenants doivent être différentes
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_encrypt_decrypt() {
        let key = [42u8; 32];
        let plaintext = b"Hello, World! This is sensitive data.";

        let (ciphertext, iv, tag) = encrypt_file(plaintext, &key).unwrap();
        
        // Le ciphertext doit être différent du plaintext
        assert_ne!(&ciphertext[..], &plaintext[..]);
        
        // Déchiffrer devrait récupérer le plaintext original
        let decrypted = decrypt_file(&ciphertext, &iv, &tag, &key).unwrap();
        assert_eq!(&decrypted[..], &plaintext[..]);
    }

    #[test]
    fn test_decrypt_with_wrong_key() {
        let key = [42u8; 32];
        let wrong_key = [99u8; 32];
        let plaintext = b"Secret message";

        let (ciphertext, iv, tag) = encrypt_file(plaintext, &key).unwrap();
        
        // Le déchiffrement avec la mauvaise clé doit échouer
        let result = decrypt_file(&ciphertext, &iv, &tag, &wrong_key);
        assert!(result.is_err());
    }

    #[test]
    fn test_decrypt_with_tampered_data() {
        let key = [42u8; 32];
        let plaintext = b"Original data";

        let (mut ciphertext, iv, tag) = encrypt_file(plaintext, &key).unwrap();
        
        // Modifier le ciphertext
        if !ciphertext.is_empty() {
            ciphertext[0] ^= 1;
        }
        
        // Le déchiffrement doit échouer (tag d'authentification invalide)
        let result = decrypt_file(&ciphertext, &iv, &tag, &key);
        assert!(result.is_err());
    }
}

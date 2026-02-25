//! Migration tool to encrypt existing unencrypted files in MiniSpace
//! 
//! This tool:
//! 1. Finds all media and documents with is_encrypted = false
//! 2. For each file:
//!    - Reads the plaintext file from disk
//!    - Encrypts it with the tenant-specific key
//!    - Writes the encrypted version back to the same path
//!    - Updates the database with encryption metadata
//! 3. Supports batching by tenant for large datasets
//! 
//! Usage:
//!   cargo run --bin encrypt-existing-files [--tenant TENANT_SLUG]
//! 
//! Environment variables:
//!   DATABASE_URL - PostgreSQL connection string
//!   ENCRYPTION_MASTER_KEY - 64-character hex encryption key
//!   MEDIA_DIR - Base directory for media files

use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use std::env;
use std::path::PathBuf;
use uuid::Uuid;

// Import from the main crate
use minispace_api::services::encryption;

#[derive(Debug)]
struct UnencryptedMedia {
    id: Uuid,
    storage_path: String,
    thumbnail_path: Option<String>,
}

#[derive(Debug)]
struct UnencryptedDocument {
    id: Uuid,
    storage_path: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables
    dotenvy::dotenv().ok();
    
    let database_url = env::var("DATABASE_URL")
        .context("DATABASE_URL environment variable required")?;
    let encryption_master_key = env::var("ENCRYPTION_MASTER_KEY")
        .context("ENCRYPTION_MASTER_KEY environment variable required")?;
    let media_dir = env::var("MEDIA_DIR")
        .context("MEDIA_DIR environment variable required")?;
    
    // Optional: filter by specific tenant
    let target_tenant = env::args().nth(1);
    
    // Decode and validate master key
    let master_key_bytes = hex::decode(&encryption_master_key)
        .context("Invalid ENCRYPTION_MASTER_KEY format (must be 64-character hex)")?;
    if master_key_bytes.len() != 32 {
        anyhow::bail!("ENCRYPTION_MASTER_KEY must be exactly 32 bytes (64 hex characters)");
    }
    let mut master_key = [0u8; 32];
    master_key.copy_from_slice(&master_key_bytes);
    
    // Connect to database
    println!("Connecting to database...");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("Failed to connect to database")?;
    
    // Get list of tenants
    let tenants: Vec<(String,)> = sqlx::query_as(
        "SELECT nspname FROM pg_namespace 
         WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public')
         AND nspname NOT LIKE 'pg_%'"
    )
    .fetch_all(&pool)
    .await
    .context("Failed to fetch tenant list")?;
    
    let mut total_media_encrypted = 0;
    let mut total_documents_encrypted = 0;
    
    for (tenant,) in tenants {
        // Skip if filtering by specific tenant
        if let Some(ref target) = target_tenant {
            if tenant != *target {
                continue;
            }
        }
        
        println!("\n=== Processing tenant: {} ===", tenant);
        
        // Derive tenant-specific key
        let tenant_key = encryption::derive_tenant_key(&master_key, &tenant)
            .context(format!("Failed to derive key for tenant {}", tenant))?;
        
        // Process media files
        let media_count = encrypt_media_files(&pool, &tenant, &media_dir, &tenant_key).await?;
        total_media_encrypted += media_count;
        
        // Process document files
        let docs_count = encrypt_document_files(&pool, &tenant, &media_dir, &tenant_key).await?;
        total_documents_encrypted += docs_count;
    }
    
    println!("\n=== Migration Complete ===");
    println!("Total media files encrypted: {}", total_media_encrypted);
    println!("Total documents encrypted: {}", total_documents_encrypted);
    println!("Total files encrypted: {}", total_media_encrypted + total_documents_encrypted);
    
    Ok(())
}

async fn encrypt_media_files(
    pool: &sqlx::PgPool,
    tenant: &str,
    media_dir: &str,
    tenant_key: &[u8; 32],
) -> Result<usize> {
    let schema = format!("\"{}\"", tenant);
    
    // Find all unencrypted media
    let unencrypted: Vec<UnencryptedMedia> = sqlx::query_as::<_, (Uuid, String, Option<String>)>(
        &format!(
            "SELECT id, storage_path, thumbnail_path 
             FROM {}.media 
             WHERE is_encrypted = false OR is_encrypted IS NULL",
            schema
        )
    )
    .fetch_all(pool)
    .await
    .context("Failed to fetch unencrypted media")?
    .into_iter()
    .map(|(id, storage_path, thumbnail_path)| UnencryptedMedia {
        id,
        storage_path,
        thumbnail_path,
    })
    .collect();
    
    if unencrypted.is_empty() {
        println!("  No unencrypted media files found for tenant {}", tenant);
        return Ok(0);
    }
    
    println!("  Found {} unencrypted media files", unencrypted.len());
    
    let mut encrypted_count = 0;
    
    for media in &unencrypted {
        // Encrypt main file
        let main_path = PathBuf::from(media_dir).join(&media.storage_path);
        
        if !main_path.exists() {
            println!("  ⚠️  Skipping media {} - file not found: {}", media.id, media.storage_path);
            continue;
        }
        
        let plaintext = tokio::fs::read(&main_path)
            .await
            .context(format!("Failed to read file: {:?}", main_path))?;
        
        let (ciphertext, iv, tag) = encryption::encrypt_file(&plaintext, tenant_key)
            .context("Encryption failed")?;
        
        // Write encrypted file back
        tokio::fs::write(&main_path, &ciphertext)
            .await
            .context(format!("Failed to write encrypted file: {:?}", main_path))?;
        
        // Handle thumbnail if exists
        let (thumb_iv, thumb_tag) = if let Some(ref thumb_path) = media.thumbnail_path {
            let thumb_full_path = PathBuf::from(media_dir).join(thumb_path);
            
            if thumb_full_path.exists() {
                let thumb_plaintext = tokio::fs::read(&thumb_full_path)
                    .await
                    .context(format!("Failed to read thumbnail: {:?}", thumb_full_path))?;
                
                let (thumb_ciphertext, thumb_iv, thumb_tag) = 
                    encryption::encrypt_file(&thumb_plaintext, tenant_key)
                        .context("Thumbnail encryption failed")?;
                
                tokio::fs::write(&thumb_full_path, &thumb_ciphertext)
                    .await
                    .context(format!("Failed to write encrypted thumbnail: {:?}", thumb_full_path))?;
                
                (Some(thumb_iv), Some(thumb_tag))
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };
        
        // Update database
        sqlx::query(&format!(
            "UPDATE {}.media 
             SET is_encrypted = true, 
                 encryption_iv = $1, 
                 encryption_tag = $2,
                 thumbnail_encryption_iv = $3,
                 thumbnail_encryption_tag = $4
             WHERE id = $5",
            schema
        ))
        .bind(&iv)
        .bind(&tag)
        .bind(&thumb_iv)
        .bind(&thumb_tag)
        .bind(media.id)
        .execute(pool)
        .await
        .context("Failed to update media record")?;
        
        encrypted_count += 1;
        
        if encrypted_count % 10 == 0 {
            println!("  Progress: {}/{} media files encrypted", encrypted_count, unencrypted.len());
        }
    }
    
    println!("  ✓ Encrypted {} media files for tenant {}", encrypted_count, tenant);
    Ok(encrypted_count)
}

async fn encrypt_document_files(
    pool: &sqlx::PgPool,
    tenant: &str,
    media_dir: &str,
    tenant_key: &[u8; 32],
) -> Result<usize> {
    let schema = format!("\"{}\"", tenant);
    
    // Find all unencrypted documents
    let unencrypted: Vec<UnencryptedDocument> = sqlx::query_as::<_, (Uuid, String)>(
        &format!(
            "SELECT id, storage_path 
             FROM {}.documents 
             WHERE is_encrypted = false OR is_encrypted IS NULL",
            schema
        )
    )
    .fetch_all(pool)
    .await
    .context("Failed to fetch unencrypted documents")?
    .into_iter()
    .map(|(id, storage_path)| UnencryptedDocument { id, storage_path })
    .collect();
    
    if unencrypted.is_empty() {
        println!("  No unencrypted documents found for tenant {}", tenant);
        return Ok(0);
    }
    
    println!("  Found {} unencrypted documents", unencrypted.len());
    
    let mut encrypted_count = 0;
    
    for doc in &unencrypted {
        let file_path = PathBuf::from(media_dir).join(&doc.storage_path);
        
        if !file_path.exists() {
            println!("  ⚠️  Skipping document {} - file not found: {}", doc.id, doc.storage_path);
            continue;
        }
        
        let plaintext = tokio::fs::read(&file_path)
            .await
            .context(format!("Failed to read document: {:?}", file_path))?;
        
        let (ciphertext, iv, tag) = encryption::encrypt_file(&plaintext, tenant_key)
            .context("Document encryption failed")?;
        
        // Write encrypted file back
        tokio::fs::write(&file_path, &ciphertext)
            .await
            .context(format!("Failed to write encrypted document: {:?}", file_path))?;
        
        // Update database
        sqlx::query(&format!(
            "UPDATE {}.documents 
             SET is_encrypted = true, 
                 encryption_iv = $1, 
                 encryption_tag = $2
             WHERE id = $3",
            schema
        ))
        .bind(&iv)
        .bind(&tag)
        .bind(doc.id)
        .execute(pool)
        .await
        .context("Failed to update document record")?;
        
        encrypted_count += 1;
        
        if encrypted_count % 10 == 0 {
            println!("  Progress: {}/{} documents encrypted", encrypted_count, unencrypted.len());
        }
    }
    
    println!("  ✓ Encrypted {} documents for tenant {}", encrypted_count, tenant);
    Ok(encrypted_count)
}

# Système de chiffrement des fichiers - Architecture technique

## Vue d'ensemble

Implémentation du chiffrement at-rest pour tous les fichiers stockés dans MiniSpace (photos, vidéos, documents, thumbnails) avec AES-256-GCM.

## Composants

### 1. Module de chiffrement (`backend/src/services/encryption.rs`)

Fonctions principales :
- `derive_tenant_key(master_key, tenant)` : Dérivation HKDF-SHA256
- `encrypt_file(plaintext, key)` : Chiffrement AES-256-GCM → (ciphertext, iv, tag)
- `decrypt_file(ciphertext, iv, tag, key)` : Déchiffrement + vérification intégrité

**Tests unitaires inclus** pour validation cryptographique.

### 2. Schéma de base de données

Migration `20240224000001_add_encryption_metadata.sql` :

```sql
-- Table media
ALTER TABLE media ADD COLUMN is_encrypted BOOLEAN DEFAULT false;
ALTER TABLE media ADD COLUMN encryption_iv BYTEA;  -- 12 bytes
ALTER TABLE media ADD COLUMN encryption_tag BYTEA;  -- 16 bytes
ALTER TABLE media ADD COLUMN thumbnail_encryption_iv BYTEA;
ALTER TABLE media ADD COLUMN thumbnail_encryption_tag BYTEA;

-- Table documents
ALTER TABLE documents ADD COLUMN is_encrypted BOOLEAN DEFAULT false;
ALTER TABLE documents ADD COLUMN encryption_iv BYTEA;
ALTER TABLE documents ADD COLUMN encryption_tag BYTEA;
```

### 3. Modèles Rust

#### `models/media.rs`
```rust
pub struct Media {
    // ... champs existants
    pub is_encrypted: bool,
    pub encryption_iv: Option<Vec<u8>>,
    pub encryption_tag: Option<Vec<u8>>,
    pub thumbnail_encryption_iv: Option<Vec<u8>>,
    pub thumbnail_encryption_tag: Option<Vec<u8>>,
}
```

#### `models/document.rs`
```rust
pub struct Document {
    // ... champs existants
    pub is_encrypted: bool,
    pub encryption_iv: Option<Vec<u8>>,
    pub encryption_tag: Option<Vec<u8>>,
}
```

### 4. Services de traitement

#### Upload média (`services/media.rs`)

Flux modifié :
1. Réception du fichier multipart
2. **Dérivation clé tenant** depuis master key
3. **Chiffrement bytes originaux** → (ciphertext, iv, tag)
4. Écriture ciphertext sur disque
5. Pour photos : génération thumbnail depuis plaintext
6. **Chiffrement thumbnail** → (thumb_ciphertext, thumb_iv, thumb_tag)
7. Insertion DB avec métadonnées crypto

```rust
pub async fn upload(
    pool: &PgPool,
    tenant: &str,
    uploader_id: Uuid,
    media_dir: &str,
    encryption_master_key: &str,  // Nouveau paramètre
    multipart: Multipart,
) -> anyhow::Result<Media>
```

#### Upload document (`services/documents.rs`)

Flux similaire sans génération de thumbnail.

### 5. Endpoint de téléchargement sécurisé

#### Avant (`routes/media.rs` - ligne 67)
```rust
pub async fn serve_media(
    State(state): State<AppState>,
    Path(path): Path<String>,
    // ... AUCUNE AUTHENTIFICATION
) -> Result<Response, StatusCode>
```

#### Après
```rust
pub async fn serve_media(
    State(state): State<AppState>,
    TenantSlug(tenant): TenantSlug,
    user: AuthenticatedUser,  // ✅ Authentification requise
    Path(path): Path<String>,
    // ...
) -> Result<Response, (StatusCode, Json<Value>)>
```

Flux de téléchargement :
1. **Extraction JWT** → user_id, tenant, role
2. **Requête DB** : `SELECT * FROM media WHERE storage_path = $1`
   - Récupère `is_encrypted`, `encryption_iv`, `encryption_tag`, `visibility`, etc.
3. **Vérification permissions** :
   - Staff → accès complet
   - Parent + `visibility=private` → seulement si uploader
   - Parent + `visibility=public` → OK
   - Parent + `visibility=group` → vérifier `child_parents` + `children.group_id`
   - Parent + `visibility=child` → vérifier `media_children` + `child_parents`
4. **Lecture fichier** depuis disque (ciphertext)
5. **Déchiffrement** avec tenant_key + iv + tag
6. **Serving** du plaintext avec support HTTP range requests

## Sécurité

### Cryptographie

- **Algorithme** : AES-256-GCM (AEAD - Authenticated Encryption with Associated Data)
- **Taille clé** : 256 bits (32 bytes)
- **IV** : 96 bits (12 bytes), généré aléatoirement via `OsRng` pour chaque fichier
- **Tag d'authentification** : 128 bits (16 bytes), détecte toute altération
- **Dérivation de clé** : HKDF-SHA256 avec info = `"minispace-tenant-{tenant}"`

### Isolation par tenant

Chaque tenant possède une clé cryptographique dérivée unique :
```
Master Key → HKDF("minispace-tenant-acme") → Tenant Key A
Master Key → HKDF("minispace-tenant-beta") → Tenant Key B
```

**Avantage** : Un tenant ne peut pas déchiffrer les fichiers d'un autre, même en cas de compromission SQL (injection, backup leak).

### Authentification et autorisation

#### Protection contre :
- ✅ Accès anonyme (JWT requis)
- ✅ Cross-tenant access (vérification tenant dans JWT vs X-Tenant header)
- ✅ IDOR (Insecure Direct Object Reference) :
  - Parents ne voient QUE les fichiers liés à leurs enfants
  - Vérification via jointures `child_parents`, `media_children`
- ✅ Path traversal (canonicalisation + vérification bounds)

#### Règles de visibilité

| Visibility | Staff | Parent (uploader) | Parent (linked child) | Parent (other) |
|------------|-------|-------------------|-----------------------|----------------|
| `private`  | ✅    | ✅                | ❌                    | ❌             |
| `public`   | ✅    | ✅                | ✅                    | ✅             |
| `group`    | ✅    | ✅                | ✅ (si child in group)| ❌             |
| `child`    | ✅    | ✅                | ✅ (si linked)        | ❌             |

## Performance

### Benchmarks théoriques

| Opération | Taille fichier | Temps ajouté (AES-256-GCM) |
|-----------|----------------|----------------------------|
| Chiffrement | 1 MB | ~5 ms |
| Chiffrement | 10 MB | ~50 ms |
| Chiffrement | 100 MB | ~500 ms |
| Déchiffrement | 1 MB | ~5 ms |
| Déchiffrement | 10 MB | ~50 ms |

*Sur CPU moderne avec AES-NI hardware acceleration*

### Limitations range requests

Pour vidéos avec range requests (streaming), le fichier entier est déchiffré en mémoire avant serving du range :

```rust
// Fichier 50 MB, client demande bytes 0-1000000 (1 MB)
let full_ciphertext = tokio::fs::read(&file_path).await?;  // 50 MB lu
let full_plaintext = decrypt_file(&full_ciphertext, &iv, &tag, &key)?;  // 50 MB déchiffré
let chunk = &full_plaintext[0..1000000];  // 1 MB servi
```

**Impact** : Overhead CPU/mémoire proportionnel à la taille totale, pas du range.

**Alternative** : Chiffrement par blocs (CTR mode) mais perte du tag d'authentification global → complexité accrue.

**Décision** : Acceptable pour fichiers <100 MB typiques dans une garderie.

## Dépendances Rust

Ajoutées dans `Cargo.toml` :

```toml
aes-gcm = "0.10"   # Chiffrement AES-256-GCM
hkdf = "0.12"      # HMAC-based Key Derivation Function
sha2 = "0.10"      # SHA-256 pour HKDF
hex = "0.4"        # Décodage clé hex depuis env var
```

**Crates audités** par la communauté Rust, maintenues par RustCrypto.

## Configuration

### Variables d'environnement

```bash
# Master key - 32 bytes en hexadécimal (64 caractères)
ENCRYPTION_MASTER_KEY=<64-char-hex-string>

# Génération recommandée :
openssl rand -hex 32
```

### Configuration Rust (`config.rs`)

```rust
pub struct Config {
    // ... champs existants
    pub encryption_master_key: String,  // ⚠️ Chargée depuis env, jamais loggée
}
```

## Migration des fichiers existants

### Script `backend/src/bin/encrypt-existing-files.rs`

Outil en ligne de commande pour chiffrer les fichiers pré-existants :

```bash
# Tous les tenants
cargo run --release --bin encrypt-existing-files

# Tenant spécifique
cargo run --release --bin encrypt-existing-files -- acme-corp
```

**Logique** :
1. Connexion PostgreSQL
2. Pour chaque tenant :
   - Requête `SELECT id, storage_path FROM media WHERE is_encrypted = false`
   - Pour chaque fichier :
     - Lire plaintext depuis disque
     - Chiffrer avec tenant_key
     - Écrire ciphertext au même path (⚠️ écrase le plaintext)
     - `UPDATE media SET is_encrypted=true, encryption_iv=$1, encryption_tag=$2`
   - Idem pour `documents` et thumbnails
3. Rapport final : nombre de fichiers chiffrés

**Idempotence** : Réexécutable en toute sécurité (skip si `is_encrypted = true`).

### Risques

- ⚠️ **Pas de rollback** : Plaintext écrasé par ciphertext
- ⚠️ **Backup obligatoire** avant migration
- ✅ **Migration progressive** : Nouveaux fichiers chiffrés immédiatement, anciens migrés en batch

## Tests

### Tests unitaires (`services/encryption.rs`)

```rust
#[test]
fn test_derive_tenant_key() { /* ... */ }

#[test]
fn test_encrypt_decrypt() { /* ... */ }

#[test]
fn test_decrypt_with_wrong_key() { /* ... */ }  // Doit échouer

#[test]
fn test_decrypt_with_tampered_data() { /* ... */ }  // Doit échouer
```

Exécution : `cargo test encryption`

### Tests d'intégration recommandés

1. **Upload + Download cycle**
   ```bash
   # Upload fichier
   POST /api/media (avec auth)
   → Vérifier is_encrypted=true en DB
   → Vérifier fichier sur disque != original (chiffré)
   
   # Download
   GET /api/media/files/{path} (avec auth)
   → Vérifier plaintext == original
   ```

2. **Permissions**
   ```bash
   # Parent A upload private photo
   POST /api/media (caption="private", visibility="private")
   
   # Parent B tente d'accéder
   GET /api/media/files/{path} (token Parent B)
   → Attendu: 403 Forbidden
   ```

3. **Thumbnail encryption**
   ```bash
   # Upload photo
   POST /api/media (image.jpg)
   
   # Vérifier thumbnail chiffré
   SELECT thumbnail_encryption_iv, thumbnail_encryption_tag 
   FROM media WHERE id = $1
   → Doivent être non-NULL
   
   # Charger thumbnail
   GET /api/media/files/{tenant}/2024/02/{id}_thumb.jpg
   → Image valide déchiffrée
   ```

## Maintenance

### Surveillance

Métriques à surveiller :
- **Taux d'échec de déchiffrement** : Spike = clé incorrecte ou corruption
- **Latence p99 des downloads** : Dégradation = CPU surchargé
- **Erreurs 403 Forbidden** : Pic = bug permissions ou attaque

Logs à créer :
```rust
tracing::warn!(
    "Decryption failed for file {} in tenant {}",
    file_id, tenant
);
```

### Rotation de clé (non implémenté)

Workflow théorique :
1. Générer `NEW_ENCRYPTION_MASTER_KEY`
2. Ajouter colonne `encryption_key_version INT` en DB
3. Script de re-chiffrement :
   ```rust
   for file in encrypted_files {
       plaintext = decrypt(file, old_key);
       (ciphertext, iv, tag) = encrypt(plaintext, new_key);
       update_db(file.id, ciphertext, iv, tag, version=2);
   }
   ```
4. Décommissionner ancienne clé après vérification complète

**Complexité** : Élevée, nécessite downtime ou double-storage temporaire.

## Ressources

- [NIST SP 800-38D - GCM Mode](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)
- [RFC 5869 - HKDF](https://tools.ietf.org/html/rfc5869)
- [RustCrypto aes-gcm docs](https://docs.rs/aes-gcm/)
- [OWASP Key Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)

## Auteur et historique

- **Version initiale** : Février 2024
- **Implémentation** : Chiffrement AES-256-GCM at-rest pour media/documents
- **Sécurité** : Authentification obligatoire + contrôle d'accès fin

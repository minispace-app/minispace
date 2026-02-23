# Guide de déploiement du chiffrement des fichiers

Ce guide explique comment déployer le système de chiffrement at-rest pour les fichiers (photos, documents, vidéos) dans MiniSpace.

## Vue d'ensemble

Le système utilise :
- **Chiffrement AES-256-GCM** pour tous les fichiers
- **Dérivation de clés par tenant** via HKDF-SHA256
- **IV et tags d'authentification uniques** pour chaque fichier
- **Authentification obligatoire** pour accéder aux fichiers
- **Contrôle d'accès basé sur les rôles** (staff/parent) et la visibilité

## Prérequis

1. PostgreSQL avec les migrations appliquées
2. Clé de chiffrement maître générée de manière sécurisée
3. Backup complet du système avant la migration

## Étape 1 : Générer la clé de chiffrement maître

La clé maître doit être un nombre aléatoire de 32 bytes (256 bits) encodé en hexadécimal :

```bash
# Générer une nouvelle clé avec OpenSSL
openssl rand -hex 32

# Exemple de sortie (64 caractères hex) :
# 8a7b3c9d2e1f4g5h6i7j8k9l0m1n2o3p4q5r6s7t8u9v0w1x2y3z4a5b6c7d8e9f
```

**⚠️ IMPORTANT : Cette clé doit être conservée de manière ultra-sécurisée !**
- Ne JAMAIS la committer dans le code source
- La stocker dans un gestionnaire de secrets sécurisé (Vault, AWS Secrets Manager, etc.)
- En cas de perte, les fichiers chiffrés seront IRRÉCUPÉRABLES

## Étape 2 : Configurer les variables d'environnement

### En développement (.env)

```bash
# Ajouter dans .env
ENCRYPTION_MASTER_KEY=votre_clé_64_caractères_hex_ici
```

### En production

```bash
# .env.prod (NE PAS COMMITTER)
ENCRYPTION_MASTER_KEY=votre_clé_64_caractères_hex_ici
```

Ou via secrets Kubernetes/Docker :
```yaml
# kubernetes secret
apiVersion: v1
kind: Secret
metadata:
  name: minispace-encryption
type: Opaque
data:
  ENCRYPTION_MASTER_KEY: <base64_encoded_key>
```

## Étape 3 : Appliquer les migrations de base de données

```bash
cd backend

# Vérifier les migrations en attente
sqlx migrate info

# Appliquer la migration 20240224000001_add_encryption_metadata.sql
sqlx migrate run
```

Cette migration ajoute :
- Colonnes `is_encrypted`, `encryption_iv`, `encryption_tag` aux tables `media` et `documents`
- Colonnes `thumbnail_encryption_iv`, `thumbnail_encryption_tag` à la table `media`
- Contraintes de validation
- Index pour optimiser les requêtes

## Étape 4 : Déployer le nouveau code

```bash
# Compiler le backend
cd backend
cargo build --release

# Déployer (exemple Docker)
docker-compose build backend
docker-compose up -d backend
```

**À partir de ce moment, tous les nouveaux fichiers uploadés seront automatiquement chiffrés.**

## Étape 5 : Migrer les fichiers existants

### 5.1 Créer un backup complet

```bash
# Backup de la base de données
pg_dump $DATABASE_URL > backup_before_encryption_$(date +%Y%m%d).sql

# Backup des fichiers
tar -czf media_backup_$(date +%Y%m%d).tar.gz $MEDIA_DIR
```

### 5.2 Exécuter le script de migration

Le script chiffre les fichiers existants de manière progressive :

```bash
cd backend

# Option 1 : Migrer tous les tenants
./scripts/encrypt-existing-files.sh

# Option 2 : Migrer un tenant spécifique
cargo run --release --bin encrypt-existing-files -- tenant-slug
```

Le script :
1. Trouve tous les fichiers avec `is_encrypted = false`
2. Lit chaque fichier depuis le disque
3. Le chiffre avec AES-256-GCM
4. Écrit la version chiffrée au même emplacement
5. Met à jour la base de données avec les métadonnées de chiffrement
6. Affiche la progression

**⏱️ Temps estimé :** ~1-2 secondes par fichier (dépend de la taille et du disque)

### 5.3 Vérifier la migration

```sql
-- Compter les fichiers non chiffrés restants
SELECT 
  (SELECT COUNT(*) FROM "<tenant>".media WHERE is_encrypted = false) as unencrypted_media,
  (SELECT COUNT(*) FROM "<tenant>".documents WHERE is_encrypted = false) as unencrypted_docs;

-- Vérifier les métadonnées de chiffrement
SELECT id, storage_path, is_encrypted, 
       length(encryption_iv) as iv_bytes, 
       length(encryption_tag) as tag_bytes
FROM "<tenant>".media
WHERE is_encrypted = true
LIMIT 5;
```

## Étape 6 : Tests post-déploiement

### Test 1 : Upload d'un nouveau fichier

```bash
curl -X POST http://localhost:8080/api/media \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant: test-tenant" \
  -F "file=@test.jpg" \
  -F "caption=Test encrypted upload" \
  -F "visibility=private"

# Vérifier que is_encrypted = true dans la réponse
```

### Test 2 : Téléchargement d'un fichier chiffré

```bash
# Sans authentification (doit échouer avec 401)
curl -I http://localhost:8080/api/media/files/test-tenant/2024/02/abc123.jpg

# Avec authentification (doit fonctionner)
curl -H "Authorization: Bearer $TOKEN" \
     -H "X-Tenant: test-tenant" \
     http://localhost:8080/api/media/files/test-tenant/2024/02/abc123.jpg \
     -o downloaded.jpg

# Vérifier que l'image se charge correctement
```

### Test 3 : Permissions de visibilité

```bash
# En tant que parent, tenter d'accéder à un fichier privé d'un autre utilisateur
# (doit échouer avec 403)

# Accéder à un fichier lié à son enfant (doit fonctionner)
```

## Architecture du chiffrement

### Dérivation des clés

```
Master Key (32 bytes)
    |
    +--> HKDF-SHA256 avec info="minispace-tenant-{tenant_name}"
             |
             +--> Tenant Key A (32 bytes)
             +--> Tenant Key B (32 bytes)
             +--> ...
```

Chaque tenant a sa propre clé dérivée, ce qui permet :
- Isolation cryptographique entre tenants
- Rotation de clé par tenant possible
- Pas de stockage de multiples clés

### Chiffrement d'un fichier

```
Plaintext File
    |
    +--> AES-256-GCM.encrypt(plaintext, tenant_key, random_iv)
             |
             +--> Ciphertext + Authentication Tag
```

Métadonnées stockées en DB :
- `encryption_iv` : 12 bytes (96 bits) - unique par fichier
- `encryption_tag` : 16 bytes (128 bits) - assure l'intégrité

### Déchiffrement et serving

```
1. Utilisateur demande /api/media/files/{path}
2. Vérification JWT + extraction tenant + user_id
3. Requête DB pour vérifier permissions (visibility, child_parents)
4. Lecture du ciphertext depuis le disque
5. Déchiffrement avec tenant_key + iv + tag
6. Vérification du tag d'authentification
7. Serving du plaintext via HTTP (avec support range requests)
```

## Considérations de performance

### Impact upload
- **Overhead :** ~5-10% (temps de chiffrement minimal)
- **Génération thumbnails :** Toujours sur plaintext, puis thumbnail chiffré

### Impact download
- **Overhead :** ~10-20% (déchiffrement en mémoire)
- **Range requests vidéo :** Fichier entier déchiffré avant serving
  - Pour optimiser : implémenter chiffrement par blocs (complexité ++++)
  - Accepter l'impact pour videos courtes (<50MB)

### Taille des fichiers
- **Augmentation :** Négligeable (~0.05% pour le tag GCM)
- **Exemple :** Fichier de 10 MB → 10.0016 MB chiffré

## Sécurité

### Ce qui est protégé ✅
- Fichiers chiffrés at-rest sur disque
- Protection contre accès physique au disque
- Intégrité garantie (tag d'authentification)
- Isolation cryptographique par tenant
- Authentification obligatoire pour accès
- Contrôle d'accès fin (visibility + child_parents)

### Ce qui n'est PAS protégé ⚠️
- Fichiers en transit (utiliser HTTPS/TLS)
- Fichiers en mémoire lors du traitement
- Métadonnées de fichiers (noms, tailles, timestamps)
- Clé maître compromise → tous les fichiers compromis

## Rotation de la clé maître

**Non implémenté dans cette version** - Nécessiterait :

1. Générer nouvelle clé maître (`NEW_ENCRYPTION_MASTER_KEY`)
2. Configurer les deux clés simultanément
3. Script de re-chiffrement :
   - Déchiffrer avec ancienne clé
   - Re-chiffrer avec nouvelle clé
   - Mettre à jour les métadonnées
4. Supprimer l'ancienne clé

**Recommandation :** Planifier une fenêtre de maintenance si rotation nécessaire.

## Rollback

### Si problème détecté avant migration des fichiers existants

```bash
# 1. Revenir au code précédent
git checkout <previous_commit>
docker-compose build backend
docker-compose up -d backend

# 2. Rollback de la migration DB
sqlx migrate revert

# Les nouveaux fichiers chiffrés seront inaccessibles jusqu'à redéploiement
```

### Si problème après migration des fichiers

**⚠️ PAS DE ROLLBACK POSSIBLE** - Les fichiers sont chiffrés de manière irréversible.

Solutions :
1. Restaurer depuis backup (avant chiffrement)
2. Corriger le bug et redéployer
3. Déchiffrer manuellement avec script si clé disponible

## Support et troubleshooting

### Erreur : "Master key must be 32 bytes"
- Vérifier que `ENCRYPTION_MASTER_KEY` fait exactement 64 caractères hex
- Régénérer avec `openssl rand -hex 32`

### Erreur : "Decryption failed"
- Clé incorrecte ou changée
- Fichier corrompu ou modifié manuellement
- IV/tag manquants ou invalides en DB

### Performance dégradée
- Surveiller CPU (chiffrement/déchiffrement)
- Considérer scaling horizontal
- Cacher les fichiers déchiffrés fréquemment accédés (attention sécurité)

### Migration bloquée
- Vérifier permissions disque (lecture/écriture)
- Vérifier espace disque disponible
- Relancer avec filtre tenant spécifique

## Checklist de déploiement

- [ ] Backup complet (DB + fichiers)
- [ ] Clé maître générée et stockée de manière sécurisée
- [ ] Variables d'environnement configurées
- [ ] Migrations DB appliquées
- [ ] Nouveau code déployé et vérifié
- [ ] Tests post-déploiement réussis
- [ ] Migration des fichiers existants lancée
- [ ] Vérification que tous les fichiers sont chiffrés
- [ ] Tests de charge si applicable
- [ ] Documentation équipe mise à jour
- [ ] Plan de rollback documenté

## Contact et support

Pour toute question ou problème :
1. Vérifier les logs du backend : `docker logs minispace-backend`
2. Consulter cette documentation
3. Contacter l'équipe DevOps/Sécurité

#!/usr/bin/env bash
# Script pour chiffrer les fichiers existants dans MiniSpace
# Ce script doit être exécuté après la migration de la base de données

set -euo pipefail

# Vérifier les variables d'environnement requises
if [ -z "${DATABASE_URL:-}" ]; then
    echo "Error: DATABASE_URL environment variable is required"
    exit 1
fi

if [ -z "${ENCRYPTION_MASTER_KEY:-}" ]; then
    echo "Error: ENCRYPTION_MASTER_KEY environment variable is required"
    exit 1
fi

if [ -z "${MEDIA_DIR:-}" ]; then
    echo "Error: MEDIA_DIR environment variable is required"
    exit 1
fi

# Compiler et exécuter le script Rust de migration
echo "Building encryption migration tool..."
cd "$(dirname "$0")/.."

# Créer un binaire temporaire pour la migration
cargo build --release --bin encrypt-existing-files

echo "Starting file encryption migration..."
echo "This may take a while depending on the number of files..."

# Exécuter la migration
./target/release/encrypt-existing-files

echo "Migration completed successfully!"

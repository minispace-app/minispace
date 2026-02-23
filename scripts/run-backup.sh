#!/bin/sh

backup_dir="/backup/host/backups"
mkdir -p "$backup_dir"

log_file="/var/log/backup.log"

log() {
  echo "$(date +'%Y-%m-%d %H:%M:%S') - $*" >> "$log_file"
}

cleanup_old_backups() {
  days="$BACKUP_RETENTION_DAYS"
  if [ -n "$days" ] && [ "$days" -ge 0 ]; then
    log "Cleaning up backups older than $days days"
    find "$backup_dir" -type f -mtime +"$days" -delete
  fi
}

run_backup() {
  timestamp=$(date +'%Y%m%d_%H%M%S')
  log "Starting backup run at $timestamp"

  # DB backup (whole DB, as manual trigger is per-tenant)
  db_file="$backup_dir/db_$timestamp.sql.gz"
  log "Dumping database to $db_file"
  if pg_dump \
     -d "postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@db:5432/$POSTGRES_DB" \
     --clean --if-exists \
     --compress=gzip \
     -f "$db_file"; then
    log "DB backup successful"
  else
    log "ERROR: DB backup failed"
    return 1
  fi

  # Media backup
  media_file="$backup_dir/media_$timestamp.tar.gz"
  log "Archiving media to $media_file"
  if tar -czf "$media_file" -C /data media 2>/dev/null; then
    log "Media backup successful"
  else
    log "ERROR: Media backup failed (no media found?)"
    return 1
  fi

  # Cleanup
  cleanup_old_backups

  log "Backup completed successfully"
}

run_backup
exit $?
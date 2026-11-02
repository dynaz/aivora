// Online backup and restore for the SQLite database.
//
// Backups use `VACUUM INTO`, which writes a fully consistent snapshot even while the service is running
// and holding read connections — no need to stop Aivora to take one. Restores DO require the service to
// be stopped (so nothing is mid-write): the CLI wrapper documents this. Every backup and restore runs an
// integrity check, and restore keeps a timestamped safety copy of the database it replaces so a bad
// restore can itself be rolled back.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function integrity(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    return row && row.integrity_check;
  } finally { db.close(); }
}

// Snapshot `dbPath` to `target` (a file path). Returns { target, bytes }. Throws if the source is missing
// or either the source or the resulting snapshot fails its integrity check.
export function backup(dbPath, target) {
  const src = resolve(dbPath);
  if (!existsSync(src)) throw new Error('Database not found: ' + src);
  const dst = resolve(target);
  if (existsSync(dst)) throw new Error('Refusing to overwrite existing backup: ' + dst);
  mkdirSync(dirname(dst), { recursive: true });
  if (integrity(src) !== 'ok') throw new Error('Source database failed integrity check; not backing up');

  const db = new DatabaseSync(src, { readOnly: true });
  try { db.exec('VACUUM INTO ' + quote(dst)); } finally { db.close(); }

  if (integrity(dst) !== 'ok') throw new Error('Backup failed integrity check: ' + dst);
  return { target: dst, bytes: statSync(dst).size };
}

// Replace the database at `dbPath` with the snapshot at `backupPath`. The caller MUST have stopped the
// service first. Validates the backup (integrity check + expected schema), saves the current database to
// `<dbPath>.pre-restore-<ISO>` when one exists, then copies the backup into place and re-verifies.
// Returns { restoredFrom, safetyCopy|null }.
export function restore(backupPath, dbPath) {
  const src = resolve(backupPath);
  if (!existsSync(src)) throw new Error('Backup not found: ' + src);
  if (integrity(src) !== 'ok') throw new Error('Backup failed integrity check; refusing to restore: ' + src);
  // A valid Aivora database carries the migration ledger; guard against restoring an unrelated file.
  const check = new DatabaseSync(src, { readOnly: true });
  try {
    const t = check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    if (!t) throw new Error('Backup does not look like an Aivora database (no schema_migrations table)');
  } finally { check.close(); }

  const dst = resolve(dbPath);
  mkdirSync(dirname(dst), { recursive: true });
  let safetyCopy = null;
  if (existsSync(dst)) {
    safetyCopy = dst + '.pre-restore-' + new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(dst, safetyCopy);
  }
  copyFileSync(src, dst);
  if (integrity(dst) !== 'ok') throw new Error('Restored database failed integrity check: ' + dst);
  return { restoredFrom: src, safetyCopy };
}

// Single-quote a SQL string literal (for the VACUUM INTO target path).
function quote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

export function defaultBackupTarget(dbPath, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return resolve(dirname(resolve(dbPath)), 'backups', 'aivora-' + stamp + '.sqlite');
}

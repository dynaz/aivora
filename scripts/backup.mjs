#!/usr/bin/env node
// Take an online, consistent snapshot of the TermiNow Store database. Safe to run while the service is up.
//
//   node scripts/backup.mjs [target.sqlite]
//
// Uses AIVORA_DB (default data/aivora.sqlite). With no argument, writes to
// <db-dir>/backups/aivora-<timestamp>.sqlite. Run from cron for scheduled backups.
import { resolve } from 'node:path';
import { backup, defaultBackupTarget } from '../src/backup.mjs';

const dbPath = resolve(process.env.AIVORA_DB || 'data/aivora.sqlite');
const target = process.argv[2] ? resolve(process.argv[2]) : defaultBackupTarget(dbPath);
try {
  const r = backup(dbPath, target);
  console.log('Backed up', dbPath, '->', r.target, '(' + r.bytes + ' bytes)');
} catch (e) {
  console.error('Backup failed:', e.message);
  process.exitCode = 1;
}

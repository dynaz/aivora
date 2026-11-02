#!/usr/bin/env node
// Restore the NowAI database from a snapshot. STOP THE SERVICE FIRST:
//
//   sudo systemctl stop aivora
//   node scripts/restore.mjs <backup.sqlite>
//   sudo systemctl start aivora
//
// Uses AIVORA_DB (default data/aivora.sqlite) as the destination. The current database, if any, is first
// copied to <db>.pre-restore-<timestamp> so this restore can itself be undone.
import { resolve } from 'node:path';
import { restore } from '../src/backup.mjs';

const backupPath = process.argv[2];
if (!backupPath) {
  console.error('Usage: restore.mjs <backup.sqlite>   (stop the service first)');
  process.exit(2);
}
const dbPath = resolve(process.env.AIVORA_DB || 'data/aivora.sqlite');
try {
  const r = restore(backupPath, dbPath);
  console.log('Restored', dbPath, 'from', r.restoredFrom);
  if (r.safetyCopy) console.log('Previous database saved to', r.safetyCopy);
  console.log('Start the service again: sudo systemctl start aivora');
} catch (e) {
  console.error('Restore failed:', e.message);
  process.exitCode = 1;
}

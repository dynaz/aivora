#!/usr/bin/env node
// Apply pending database migrations and report which ran. Idempotent: safe to run on every deploy.
//
//   node scripts/migrate.mjs
//
// Uses AIVORA_DB (default data/aivora.sqlite). The migration ledger lives in schema_migrations, so a
// migration is applied at most once; a re-run on an up-to-date database applies nothing and exits 0.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrate } from '../src/migrations.mjs';

const path = resolve(process.env.AIVORA_DB || 'data/aivora.sqlite');
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
try {
  const applied = migrate(db);
  console.log(applied.length ? 'Applied migrations: ' + applied.join(', ') : 'Database already up to date.');
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exitCode = 1;
} finally { db.close(); }

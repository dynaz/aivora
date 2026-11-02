#!/usr/bin/env node
// Out-of-band admin role management. This is the ONLY way to grant admin access — there is no API or
// signup path. Run on the server as the service user against the live database.
//
//   node scripts/admin.mjs list
//   node scripts/admin.mjs grant <email> <admin|superadmin>
//   node scripts/admin.mjs revoke <email>
//
// Uses AIVORA_DB (default data/aivora.sqlite). Applies pending migrations first so the admins table
// exists on a fresh database.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { migrate } from '../src/migrations.mjs';
import { Admins } from '../src/admin.mjs';

const [cmd, email, role] = process.argv.slice(2);
const path = resolve(process.env.AIVORA_DB || 'data/aivora.sqlite');
const db = new DatabaseSync(path);
try {
  migrate(db);
  const admins = new Admins(db);
  if (cmd === 'list') {
    const rows = admins.list();
    if (!rows.length) console.log('No admins.');
    for (const r of rows) console.log(r.role.padEnd(11), r.email);
  } else if (cmd === 'grant') {
    admins.setRole(email, role);
    console.log('Granted', role, 'to', email.trim().toLowerCase());
  } else if (cmd === 'revoke') {
    console.log(admins.remove(email) ? 'Revoked admin from ' + email.trim().toLowerCase() : 'No such admin.');
  } else {
    console.error('Usage: admin.mjs list | grant <email> <admin|superadmin> | revoke <email>');
    process.exitCode = 2;
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
} finally { db.close(); }

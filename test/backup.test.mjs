import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/migrations.mjs';
import { Entitlements } from '../src/entitlements.mjs';
import { backup, restore, defaultBackupTarget } from '../src/backup.mjs';

function freshDb(path) { const d = new DatabaseSync(path); migrate(d); return d; }

test('backup then restore round-trips committed data and keeps a safety copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aivora-bak-'));
  const dbPath = join(dir, 'aivora.sqlite');
  try {
    // State A: one entitlement.
    let d = freshDb(dbPath);
    new Entitlements(d).grantTx('e-a', 'user@x', 'terminow-premium', 30, 'test', 1000);
    d.close();

    // Snapshot state A.
    const target = defaultBackupTarget(dbPath);
    const r = backup(dbPath, target);
    assert.ok(existsSync(r.target));
    assert.ok(r.bytes > 0);
    assert.throws(() => backup(dbPath, target), /Refusing to overwrite/); // never clobber a backup

    // Mutate to state B (a second, different entitlement).
    d = new DatabaseSync(dbPath);
    new Entitlements(d).grantTx('e-b', 'user@x', 'addon-network-scan', null, 'test', 2000);
    assert.equal(new Entitlements(d).list('user@x').length, 2);
    d.close();

    // Restore state A over state B.
    const rr = restore(target, dbPath);
    assert.ok(rr.safetyCopy && existsSync(rr.safetyCopy)); // state B preserved for undo
    d = new DatabaseSync(dbPath);
    const ents = new Entitlements(d).list('user@x');
    assert.equal(ents.length, 1);
    assert.equal(ents[0].feature_key, 'terminow-premium');
    d.close();

    // The safety copy really is state B (so the restore itself is reversible).
    const back = new DatabaseSync(rr.safetyCopy, { readOnly: true });
    assert.equal(back.prepare('SELECT COUNT(*) c FROM entitlements').get().c, 2);
    back.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('restore refuses a non-Aivora or corrupt file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aivora-bak-'));
  try {
    const dbPath = join(dir, 'aivora.sqlite');
    freshDb(dbPath).close();

    // A valid SQLite file that is not an Aivora database.
    const foreign = join(dir, 'foreign.sqlite');
    const f = new DatabaseSync(foreign); f.exec('CREATE TABLE whatever(x)'); f.close();
    assert.throws(() => restore(foreign, dbPath), /does not look like an Aivora database/);

    // Not even a SQLite file.
    const junk = join(dir, 'junk.sqlite');
    writeFileSync(junk, 'this is not a database');
    assert.throws(() => restore(junk, dbPath));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

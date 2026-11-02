import { DatabaseSync } from 'node:sqlite';

// One shared demo account. Production needs authenticated, per-user accounts.
export class Ledger {
  #db;
  constructor(initial = 100, path = ':memory:') {
    if (!Number.isSafeInteger(initial) || initial < 0) throw new Error('Invalid initial credits');
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1), balance INTEGER NOT NULL CHECK(balance>=0));
      CREATE TABLE IF NOT EXISTS charges (id TEXT PRIMARY KEY, amount INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    this.#db.prepare('INSERT OR IGNORE INTO account VALUES (1, ?)').run(initial);
  }
  get balance() { return this.#db.prepare('SELECT balance FROM account WHERE id=1').get().balance; }
  history() { return this.#db.prepare('SELECT id, amount, created_at FROM charges ORDER BY rowid DESC LIMIT 20').all(); }
  close() { this.#db.close(); }
  charge(id, amount, payload = '') {
    if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new Error('Invalid request ID');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invalid charge');
    if (typeof payload !== 'string') throw new Error('Invalid payload');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.#db.prepare('SELECT amount,payload FROM charges WHERE id=?').get(id);
      if (previous) {
        if (previous.amount !== amount || previous.payload !== payload) throw new Error('Request ID conflict');
        const result = { balance: this.balance, charged: false };
        this.#db.exec('COMMIT');
        return result;
      }
      const updated = this.#db.prepare('UPDATE account SET balance=balance-? WHERE id=1 AND balance>=?').run(amount,amount);
      if (!updated.changes) throw new Error('Insufficient credits');
      this.#db.prepare('INSERT INTO charges(id,amount,payload) VALUES (?,?,?)').run(id,amount,payload);
      const result = { balance: this.balance, charged: true };
      this.#db.exec('COMMIT');
      return result;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
}

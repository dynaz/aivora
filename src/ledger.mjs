export class Ledger {
  #balance;
  #charges = new Map();
  constructor(initial = 100) {
    if (!Number.isSafeInteger(initial) || initial < 0) throw new Error('Invalid initial credits');
    this.#balance = initial;
  }
  get balance() { return this.#balance; }
  charge(id, amount) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new Error('Invalid request ID');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invalid charge');
    if (this.#charges.has(id)) {
      if (this.#charges.get(id) !== amount) throw new Error('Request ID conflict');
      return { balance: this.#balance, charged: false };
    }
    if (amount > this.#balance) throw new Error('Insufficient credits');
    this.#balance -= amount;
    this.#charges.set(id, amount);
    return { balance: this.#balance, charged: true };
  }
}

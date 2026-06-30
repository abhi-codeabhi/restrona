// @restorna/core — shared kernel: Result, errors, Money, ids, clock, logger.
// Pure, dependency-free, framework-free. Imported everywhere; imports nothing.
import { randomUUID } from 'node:crypto';

/* ---------- Result<T,E> (no exceptions across boundaries) ---------- */
export const ok = (value) => ({ ok: true, value });
export const err = (error) => ({ ok: false, error });
export const isOk = (r) => r.ok === true;
export const isErr = (r) => r.ok === false;
export const mapResult = (r, f) => (r.ok ? ok(f(r.value)) : r);
export const unwrap = (r) => {
  if (r.ok) return r.value;
  throw r.error instanceof Error ? r.error : new Error(String(r.error));
};

/* ---------- Error taxonomy ---------- */
export class AppError extends Error {
  constructor(code, message, { status = 500, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details }; }
}
export class ValidationError extends AppError {
  constructor(message, details) { super('VALIDATION', message, { status: 422, details }); }
}
export class NotFoundError extends AppError {
  constructor(message = 'Not found') { super('NOT_FOUND', message, { status: 404 }); }
}
export class DomainError extends AppError {
  constructor(code, message) { super(code, message, { status: 409 }); }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') { super('UNAUTHORIZED', message, { status: 401 }); }
}

/* ---------- Money value object (integer minor units, e.g. paise) ---------- */
export class Money {
  constructor(minor, currency = 'INR') {
    if (!Number.isInteger(minor)) throw new Error('Money minor units must be an integer');
    this.minor = minor;
    this.currency = currency;
  }
  static rupees(n, currency = 'INR') { return new Money(Math.round(n * 100), currency); }
  static zero(currency = 'INR') { return new Money(0, currency); }
  #same(o) { if (o.currency !== this.currency) throw new Error('Currency mismatch'); }
  add(o) { this.#same(o); return new Money(this.minor + o.minor, this.currency); }
  multiply(qty) { return new Money(this.minor * qty, this.currency); }
  percent(p) { return new Money(Math.round((this.minor * p) / 100), this.currency); }
  get major() { return this.minor / 100; }
  format() { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: this.currency }).format(this.minor / 100); }
  toJSON() { return { minor: this.minor, currency: this.currency, formatted: this.format() }; }
}

/* ---------- Sortable, prefixed ids (ULID-like) ---------- */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newId(prefix) {
  let n = Date.now(), ts = '';
  for (let i = 0; i < 9; i++) { ts = B32[n % 32] + ts; n = Math.floor(n / 32); }
  const rand = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  return `${prefix ? prefix + '_' : ''}${ts}${rand}`;
}

/* ---------- Clock (injectable for deterministic tests) ---------- */
export const systemClock = { now: () => new Date() };
export const fixedClock = (iso) => ({ now: () => new Date(iso) });

/* ---------- Logger (impl of a Logger port; tenant-tagged) ---------- */
export const createLogger = (base = {}) => {
  const emit = (level, msg, ctx) =>
    console.log(JSON.stringify({ level, msg, ...base, ...ctx, at: new Date().toISOString() }));
  return {
    info: (m, c) => emit('info', m, c),
    warn: (m, c) => emit('warn', m, c),
    error: (m, c) => emit('error', m, c),
    child: (c) => createLogger({ ...base, ...c }),
  };
};

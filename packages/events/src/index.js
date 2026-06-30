// @restorna/events — event bus + transactional outbox (in-memory reference impls).
// Prod: EventBus -> NATS JetStream; Outbox -> Postgres table + CDC relay.
// The interfaces are identical, so swapping adapters needs no domain changes.

/** In-memory pub/sub bus. */
export class InMemoryEventBus {
  #subs = new Map();
  subscribe(type, handler) {
    const arr = this.#subs.get(type) ?? [];
    arr.push(handler);
    this.#subs.set(type, arr);
    return () => this.#subs.set(type, (this.#subs.get(type) ?? []).filter((h) => h !== handler));
  }
  async publish(evt) {
    for (const h of this.#subs.get(evt.type) ?? []) await h(evt);
  }
}

/**
 * Transactional outbox: in production the business write and the event row commit
 * in ONE Postgres transaction; a relay ships rows to the broker (at-least-once).
 * Here, `add()` stages events and `relayTo(bus)` drains them — same guarantee shape.
 */
export class InMemoryOutbox {
  #pending = [];
  add(evt) { this.#pending.push(evt); }
  size() { return this.#pending.length; }
  peek() { return [...this.#pending]; }
  async relayTo(bus) {
    const batch = this.#pending;
    this.#pending = [];
    for (const e of batch) await bus.publish(e);
    return batch.length;
  }
}

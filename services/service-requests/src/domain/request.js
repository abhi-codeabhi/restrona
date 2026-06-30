// Service-requests domain — pure aggregate. No I/O, no framework. Unit-testable.
// A "request" is a guest-raised waiter call (call | water | bill | cutlery) tied to
// a table. Lifecycle: assigned -> escalated -> done. Time is passed in explicitly as
// `now` (epoch ms) so escalation/cooldown logic is fully deterministic in tests.
import { newId } from '#core';

// The kinds of service a guest can request from the table.
export const TYPES = ['call', 'water', 'bill', 'cutlery'];

// Raise a fresh request. If a waiter is already assigned it starts 'assigned'
// (and is eligible for escalation); otherwise it is 'escalated' immediately
// (nobody owns it yet — surface it on the escalation queue).
export function raise({ type, table, assignedTo = null, now }) {
  return {
    id: newId('req'),
    type,
    table,
    assignedTo,
    state: assignedTo ? 'assigned' : 'escalated',
    createdAt: now,
    ackedAt: null,
  };
}

// True when an assigned request has been waiting >= escalationSecs without ack.
export function shouldEscalate(req, now, escalationSecs) {
  return req.state === 'assigned' && (now - req.createdAt) / 1000 >= escalationSecs;
}

// Flip a request to 'escalated' (immutable update).
export function escalate(req) {
  return { ...req, state: 'escalated' };
}

// Acknowledge / complete a request: state 'done', stamp ackedAt with now.
export function acknowledge(req, now) {
  return { ...req, state: 'done', ackedAt: now };
}

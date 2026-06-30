// Local command validators (dependency-free) returning Result, same shape as #contracts.
import { ok, err, ValidationError } from '#core';
import { PLANS } from '../domain/tenant.js';

export function validateProvisionTenant(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  if (!input.owner) e.push('owner is required');
  if (!input.email || !String(input.email).includes('@')) e.push('a valid email is required');
  if (!PLANS.includes(input.plan)) e.push(`plan must be one of ${PLANS.join('|')}`);
  return e.length ? err(new ValidationError('Invalid tenant', e)) : ok(input);
}

export function validateAddRestaurant(input) {
  const e = [];
  if (!input || typeof input !== 'object') return err(new ValidationError('Request body required'));
  if (!input.name) e.push('name is required');
  return e.length ? err(new ValidationError('Invalid restaurant', e)) : ok(input);
}

// Catalog domain — menu item aggregate. Pure, no I/O. Money in integer minor units (paise).
import { Money, newId, DomainError } from '#core';

// Dietary flag keys an item may declare. Each is a 0/1 marker on the item.
export const DIETARY_FLAGS = [
  'dairy', 'nuts', 'fish', 'meat', 'egg', 'gluten', 'alcohol', 'sugar', 'spicy', 'raw',
];

export function createItem({ name, categoryId, priceMinor, veg = false, tags = {}, prepMinutes = 0, id = newId('item') }) {
  if (!name || !String(name).trim()) throw new DomainError('INVALID_ITEM', 'Item name is required');
  if (!Number.isInteger(priceMinor) || priceMinor <= 0) throw new DomainError('INVALID_ITEM', 'priceMinor must be a positive integer');
  // Normalise dietary flags into a clean 0/1 map.
  const normTags = {};
  for (const [k, v] of Object.entries(tags ?? {})) normTags[k] = v ? 1 : 0;
  return {
    id,
    name: String(name).trim(),
    categoryId: categoryId ?? null,
    price: new Money(priceMinor, 'INR'),
    veg: !!veg,
    tags: normTags,
    prepMinutes: Number.isInteger(prepMinutes) ? prepMinutes : 0,
    available: true,
  };
}

export function setAvailability(item, bool) {
  return { ...item, available: !!bool };
}

export function hasFlag(item, flag) {
  return !!(item.tags && item.tags[flag]);
}

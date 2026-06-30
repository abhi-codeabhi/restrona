// Dietary guardrail — pure preference engine over item dietary flags.
// A preference lists flags to AVOID; an item violates a preference if it carries any avoided flag.
import { hasFlag } from './menuItem.js';

export const PREFS = {
  vegetarian: { id: 'vegetarian', label: 'Vegetarian', avoid: ['meat', 'fish'] },
  vegan: { id: 'vegan', label: 'Vegan', avoid: ['meat', 'fish', 'dairy', 'egg'] },
  eggless: { id: 'eggless', label: 'Eggless', avoid: ['egg'] },
  pregnancy: { id: 'pregnancy', label: 'Pregnancy-safe', avoid: ['fish', 'alcohol', 'raw'] },
  glutenfree: { id: 'glutenfree', label: 'Gluten-free', avoid: ['gluten'] },
  nutfree: { id: 'nutfree', label: 'Nut-free', avoid: ['nuts'] },
  lowsugar: { id: 'lowsugar', label: 'Low-sugar', avoid: ['sugar'] },
  mild: { id: 'mild', label: 'Mild (not spicy)', avoid: ['spicy'] },
};

export function listPrefs() {
  return Object.values(PREFS);
}

// evaluateItem(item, activePrefIds[]) -> { ok:boolean, reasons:string[] }
// ok === true means the item is safe for ALL active preferences.
export function evaluateItem(item, activePrefIds = []) {
  const reasons = [];
  for (const prefId of activePrefIds) {
    const pref = PREFS[prefId];
    if (!pref) continue;
    for (const flag of pref.avoid) {
      if (hasFlag(item, flag)) {
        reasons.push(`${item.name} contains ${flag}, not allowed for ${pref.label}`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons };
}

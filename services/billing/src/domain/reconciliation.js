// Reconciliation domain — match captured payments against bank settlements.
// Pure function. Matches by transaction ref (preferred) or by amount.
import { Money } from '#core';

const INR = 'INR';

/**
 * reconcile(payments[], bankSettlements[])
 *   payments        = [{ id, ref?, amountMinor }]
 *   bankSettlements = [{ ref?, amountMinor }]
 * Matches each payment to a settlement by ref first, else by exact amount.
 * Returns:
 *   { matched: Money, mismatches: [{ paymentId, expected, settled }] }
 * A mismatch is flagged when no settlement is found, or the settled amount
 * differs from the captured amount.
 */
export function reconcile(payments = [], bankSettlements = []) {
  const remaining = bankSettlements.map((s) => ({ ...s, _used: false }));
  let matchedMinor = 0;
  const mismatches = [];

  for (const p of payments) {
    // 1) try to match by ref.
    let idx = -1;
    if (p.ref != null) {
      idx = remaining.findIndex((s) => !s._used && s.ref != null && s.ref === p.ref);
    }
    // 2) fall back to exact amount match.
    if (idx === -1) {
      idx = remaining.findIndex((s) => !s._used && s.amountMinor === p.amountMinor);
    }

    if (idx === -1) {
      mismatches.push({
        paymentId: p.id,
        expected: new Money(p.amountMinor, INR),
        settled: null,
      });
      continue;
    }

    const settlement = remaining[idx];
    settlement._used = true;
    if (settlement.amountMinor === p.amountMinor) {
      matchedMinor += settlement.amountMinor;
    } else {
      mismatches.push({
        paymentId: p.id,
        expected: new Money(p.amountMinor, INR),
        settled: new Money(settlement.amountMinor, INR),
      });
    }
  }

  return { matched: new Money(matchedMinor, INR), mismatches };
}

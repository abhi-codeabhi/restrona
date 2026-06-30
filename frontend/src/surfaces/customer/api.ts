import { createClient, BASES } from '../../lib/api';

const c = createClient(BASES.customer);

export const customerApi = {
  getMenu: (prefs?: string[]) =>
    c.get('/menu' + (prefs && prefs.length ? `?prefs=${encodeURIComponent(prefs.join(','))}` : '')),
  placeOrder: (order: any) => c.post('/orders', order),
  getOrder: (id: string) => c.get('/orders/' + id),
  quote: (body: any) => c.post('/checkout/quote', body),
  serviceRequest: (body: any) => c.post('/service-requests', body),
};

// The /menu response shape varies (array of items, {items:[...]}, or [{item,suitable,reasons}]
// when prefs are sent). Normalise to a stable shape the UI renders.
export function normalizeMenu(res: any): any[] {
  const raw = Array.isArray(res) ? res : res?.items ?? res?.menu ?? [];
  return raw.map((row: any) => {
    const it = row.item ?? row; // annotated rows wrap the item
    const priceMinor = it.priceMinor ?? it.price?.minor ?? it.unitPriceMinor ?? 0;
    return {
      id: it.id,
      name: it.name,
      categoryId: it.categoryId ?? it.category ?? 'menu',
      priceMinor,
      veg: it.veg ?? true,
      tags: it.tags ?? [],
      available: it.available !== false,
      prepMinutes: it.prepMinutes,
      rating: it.rating,
      suitable: row.suitable ?? row.ok ?? true,
      reasons: row.reasons ?? [],
    };
  });
}

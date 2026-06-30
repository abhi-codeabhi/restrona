// End-to-end smoke: boot the service, drive the API, print results.
import { buildApp } from '../services/ordering/src/main.js';

const { server } = buildApp();
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const H = { 'content-type': 'application/json', 'x-tenant-id': 'acme' };

const place = await (await fetch(`${base}/orders`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ tableId: 'T12', items: [
    { menuItemId: 'paneer', name: 'Paneer Tikka Bowl', unitPriceMinor: 24000, qty: 1 },
    { menuItemId: 'naan', name: 'Garlic Naan', unitPriceMinor: 6000, qty: 2 },
  ] }),
})).json();
console.log('\nPlaced order:', place.order.id, '→', place.totals.total.formatted);

const s = await (await fetch(`${base}/sessions`, { method: 'POST', headers: H,
  body: JSON.stringify({ tableId: 'T12', participants: [{ id: 'Y' }, { id: 'R' }, { id: 'A' }] }) })).json();
await fetch(`${base}/sessions/${s.id}/items`, { method: 'POST', headers: H, body: JSON.stringify({ participantId: 'Y', name: 'Paneer', priceMinor: 24000 }) });
await fetch(`${base}/sessions/${s.id}/items`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Platter', priceMinor: 46000, shared: true }) });
const split = await (await fetch(`${base}/sessions/${s.id}/split?mode=by_item`, { headers: H })).json();
console.log('Split by item:', Object.fromEntries(Object.entries(split.split).map(([k, v]) => [k, v.formatted])));

server.close();

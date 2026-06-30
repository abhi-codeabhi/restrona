# Per-persona OTP login (Supabase Auth)

OTP is handled by **Supabase Auth** (email or phone). The app maps a verified user
to their persona (role) + tenant + restaurant via the `me()` RPC, then gates each
surface accordingly. **Customer stays open** (anonymous QR table session — no login).

## Turn it on
1. Run the migrations in Supabase (SQL editor), in order:
   `001_ordering_init.sql` → `002_saas_schema.sql` → `003_auth_profiles.sql`.
2. Supabase → Authentication → Providers: enable **Email** (OTP works out of the box).
   For phone OTP, enable **Phone** and configure an SMS provider (Twilio/MessageBird).
3. Supabase → Project Settings → API: copy the **Project URL** and **anon key**.
4. Set front-end env (Vercel/Render → `restorna-web`, or local `.env`):
   ```
   VITE_SUPABASE_URL = https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY = <anon key>
   ```
   Redeploy `restorna-web` (Vite bakes env at build time).

If these two vars are **blank, login is disabled** and every surface stays open —
so the current deploy keeps working until you flip it on.

## Who can sign in (from the seed)
- Owner: `aarav@restorna.co` → opens the Owner console (and any surface).
- Staff: the seeded waiters/managers/kitchen/cashier got demo emails from
  `003` (e.g. `waiter1@demo.restorna.co`). Check them:
  `select email, role from staff where tenant_id='11111111-1111-1111-1111-111111111111';`
- A signed-in user whose role doesn't match the surface sees a polite "can't open
  this app" with a sign-out link.

## How it flows
```
OTP verify (Supabase) → session(JWT) → rpc('me') → { role, tenant_id, restaurant_id }
   → app sends Authorization: Bearer <jwt> + x-tenant-id: <tenant_id> to the BFFs
   → RequireRole gates the surface to allowed personas
```

## Notes
- `me()` lazily creates the `user_profiles` link on first login by matching the
  login email/phone to `staff` (or `tenants` for the owner). No manual linking.
- To add a real staff member: insert them into `staff` with their email/phone;
  next time they OTP-in, they're recognised automatically.
- BFFs currently trust `x-tenant-id`; the production hardening step is to verify
  the Supabase JWT in the BFF and derive the tenant from it server-side.

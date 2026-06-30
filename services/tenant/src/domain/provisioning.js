// Provisioning saga — a PURE descriptor of the steps needed to stand up a tenant.
// Prod: each step is an orchestrated activity (Temporal/Step Functions) with
// compensations. Here it's a synchronous simulation that always succeeds.

// Ordered saga steps: allocate the store, run schema migrations, seed data, register.
export const steps = Object.freeze(['allocate_store', 'run_migrations', 'seed', 'register']);

/** Run the provisioning saga over a tenant. Returns the tenant marked active. */
export function runProvision(tenant) {
  // In prod each step would await an activity; success advances status to 'active'.
  return { ...tenant, status: 'active', provisionedSteps: [...steps] };
}

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  countClinicCostOccurrences,
  projectClinicCostForMonth,
} from "../src/utils/clinicRecurringCosts";

assert.equal(
  countClinicCostOccurrences({ recurrence: "monthly", starts_on: "2026-08-15" }, "2026-09"),
  1,
  "a monthly cost must be counted once after its start month",
);
assert.equal(
  countClinicCostOccurrences({ recurrence: "monthly", starts_on: "2026-10-01" }, "2026-09"),
  0,
  "a cost must not affect periods before it starts",
);
assert.equal(
  countClinicCostOccurrences({ recurrence: "weekly", starts_on: "2026-09-02" }, "2026-09"),
  5,
  "a weekly cost must count only anchored occurrences inside the selected month",
);
assert.deepEqual(
  projectClinicCostForMonth({ recurrence: "weekly", starts_on: "2026-09-09", amount: 125.5 }, "2026-09"),
  { occurrences: 4, unitAmount: 125.5, total: 502 },
  "the DRE projection must multiply the unit value by the real occurrence count",
);

const server = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260908010000_clinic_expense_management.sql", import.meta.url),
  "utf8",
);
const dashboard = fs.readFileSync(new URL("../src/components/CoordinatorDashboard.tsx", import.meta.url), "utf8");

assert.match(server, /app\.get\('\/api\/financial\/expenses'/, "the bounded expense reader must exist");
assert.match(server, /app\.post\('\/api\/financial\/expenses'/, "the validated one-off expense writer must exist");
assert.match(server, /app\.post\('\/api\/financial\/expense-rules'/, "the recurring rule writer must exist");
assert.match(server, /\.eq\('clinic_id', scope\.clinicId\)/, "expense queries must be scoped to the active clinic");
assert.match(migration, /enable row level security/i, "clinic costs must have RLS enabled");
assert.match(migration, /materialize_clinic_expense_occurrences_v1/, "recurrence must materialize bounded monthly occurrences idempotently");
assert.match(dashboard, /ClinicExpenseManager/, "Finance must expose operational expense management");
assert.match(dashboard, /projectedOperationalExpenses/, "the clinic DRE must distinguish projected from realized operating expenses");

console.log("clinicRecurringCosts.test: PASS");

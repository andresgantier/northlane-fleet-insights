"use server";

import { getAppUser } from "@/lib/session";
import { queryAsUser } from "@/lib/db";

export type OpenFrcOutcome = { result: string; message: string; repeated: boolean };

// Called only by the Confirm button of a proposal card, never by the model.
// The database function enforces the rules (role, critical case, no active FRC, idempotency) and audits.
export async function confirmOpenFrc(vehicleId: number, requestId: string): Promise<OpenFrcOutcome> {
  const user = await getAppUser();
  if (!Number.isInteger(vehicleId) || vehicleId <= 0) throw new Error("Invalid vehicle");
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error("Invalid request");
  const [rows] = await queryAsUser(
    user.id,
    (sql) => [sql`select app.open_fleet_review_case(${vehicleId}, ${requestId}::uuid) as outcome`],
    { readOnly: false },
  );
  return rows[0].outcome as OpenFrcOutcome;
}

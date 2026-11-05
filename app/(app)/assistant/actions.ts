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

const CHANGE_STATUS: Record<string, string> = {
  closed_with_action_plan: "Review Case Closed – With Action Plan",
  closed_no_action_plan: "Review Case Closed – No Action Plan",
  declined: "Review Case Declined",
  aborted: "Review Case Aborted",
};
const isoDate = (d: string | null) => (d === null || /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

// Confirm button of an FRC change card (close, correct dates, record a past FRC). Rules and audit in the database.
export async function confirmFrcChange(input: {
  vehicleId: number;
  requestId: string;
  action: "close" | "edit" | "record_past";
  status: string | null;
  startDate: string | null;
  endDate: string | null;
}): Promise<OpenFrcOutcome> {
  const user = await getAppUser();
  if (!Number.isInteger(input.vehicleId) || input.vehicleId <= 0) throw new Error("Invalid vehicle");
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new Error("Invalid request");
  if (!["close", "edit", "record_past"].includes(input.action)) throw new Error("Invalid action");
  const status = input.action === "edit" ? null : CHANGE_STATUS[input.status ?? "closed_no_action_plan"] ?? null;
  const [rows] = await queryAsUser(
    user.id,
    (sql) => [
      sql`select app.change_fleet_review_case(${input.vehicleId}, ${input.requestId}::uuid, ${input.action}, ${status},
                 ${isoDate(input.startDate)}::date, ${isoDate(input.endDate)}::date) as outcome`,
    ],
    { readOnly: false },
  );
  return rows[0].outcome as OpenFrcOutcome;
}

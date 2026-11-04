import { Suspense } from "react";
import { connection } from "next/server";
import { getAppUser } from "@/lib/session";
import { Chat } from "@/components/assistant/chat";

export default function AssistantPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Fleet assistant</h1>
        <p className="text-sm text-muted-foreground">
          Answers come from the same definitions as the dashboard. Each answer shows how it was calculated.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AssistantChat />
      </Suspense>
    </>
  );
}

async function AssistantChat() {
  await connection();
  const user = await getAppUser();
  const supervisor = user.role === "depot_supervisor";
  const suggestions = supervisor
    ? [
        "¿Qué remolques de mi sucursal pasaron más de 20 días parados este semestre?",
        "How many critical cases does my depot have, and which condition do they meet?",
        "Wie hat sich die Ausfallzeit in meinem Depot in den letzten 12 Monaten pro Monat entwickelt?",
        "Which downtime category causes the most downtime days?",
      ]
    : [
        "Which depots have the most critical cases?",
        "¿Qué remolques pasaron más de 20 días parados en los últimos 6 meses?",
        "Wie hat sich die Ausfallzeit in den letzten 12 Monaten pro Monat entwickelt?",
        "Top 10 vehicles by downtime days this year",
        "¿Qué categoría de baja genera más días de inactividad?",
      ];
  return <Chat suggestions={suggestions} />;
}

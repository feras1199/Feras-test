"use client";
import { QuickForm } from "../QuickForm";

export function ProjectStatusForm({ project: p }: { project: { id: string; status: string; health: string; progress: number; nextAction: string; nextActionDate: string; startDate: string; completionDate: string } }) {
  return (
    <QuickForm endpoint={`/api/projects/${p.id}`} method="PATCH" submitLabel="Update" resetOnSuccess={false} fields={[
      { name: "status", label: "Status", type: "select", required: true, defaultValue: p.status, options: ["Proposed", "Accepted / Pre-start", "In Progress", "On Hold", "Completed", "Cancelled"] },
      { name: "health", label: "Health", type: "select", defaultValue: p.health, options: ["On Track", "At Risk", "Delayed", "Completed"] },
      { name: "progress", label: "Progress %", type: "percent", defaultValue: String(Math.round(p.progress * 100)) },
      { name: "nextActionDate", label: "Next action date", type: "date", defaultValue: p.nextActionDate },
      { name: "nextAction", label: "Next action", type: "text", defaultValue: p.nextAction, full: true },
      { name: "startDate", label: "Start", type: "date", defaultValue: p.startDate },
      { name: "completionDate", label: "Target completion", type: "date", defaultValue: p.completionDate },
    ]} />
  );
}

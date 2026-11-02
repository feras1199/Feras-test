import { PageHeader, Empty } from "@/components/ui";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { can } from "@/lib/auth/roles";
import { aiConfigured } from "@/lib/ai/client";
import { requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask ATLAS" };

export default async function AssistantPage() {
  const s = await requirePage("ai.use");
  const suggestions = [
    "What needs my attention today?",
    can(s.role, "crm.view") && "Which enquiries have overdue follow-ups?",
    can(s.role, "finance.view") && "Which payments are overdue?",
    can(s.role, "projects.view") && "How are the active projects tracking?",
    "What are my open tasks?",
  ].filter((x): x is string => !!x);
  return (
    <>
      <PageHeader title="Ask ATLAS" subtitle="Answers come from your records. ATLAS can suggest tasks and follow-ups, but nothing is saved until you confirm it." />
      {aiConfigured() ? (
        <AssistantChat suggestions={suggestions} canPropose={can(s.role, "crm.edit")} />
      ) : (
        <Empty title="The assistant isn't set up yet">
          An administrator needs to add an Anthropic API key (ANTHROPIC_API_KEY) to the server settings. Until then ATLAS won't answer questions, and nothing else in the app is affected.
        </Empty>
      )}
    </>
  );
}

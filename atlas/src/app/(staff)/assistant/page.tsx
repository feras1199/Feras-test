import { PageHeader, Empty } from "@/components/ui";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { can } from "@/lib/auth/roles";
import { aiConfigured } from "@/lib/ai/client";
import { aiDemoMode } from "@/lib/ai/demo";
import { getRepo } from "@/lib/server/context";
import { fileStoreOf } from "@/lib/data/repository";
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
    can(s.role, "estimates.edit") && "How do I fill an estimate from a supplier quote PDF?",
    "I'd like to suggest a change to ATLAS",
  ].filter((x): x is string => !!x);
  return (
    <>
      <PageHeader title="Ask ATLAS" subtitle="Answers come from your records. Share a PDF, photo or voice note and ATLAS suggests customer details and estimate lines from it. It can also suggest tasks and follow-ups, and write up ideas for changing ATLAS. Nothing is saved until you confirm it, it never overwrites what someone typed, and it can't change ATLAS itself." />
      {aiConfigured() || aiDemoMode() ? (
        <AssistantChat suggestions={suggestions} canShare={!!fileStoreOf(getRepo())} />
      ) : (
        <Empty title="The assistant isn't set up yet">
          An administrator needs to add an Anthropic API key (ANTHROPIC_API_KEY) to the server settings. Until then ATLAS won't answer questions, and nothing else in the app is affected.
        </Empty>
      )}
    </>
  );
}

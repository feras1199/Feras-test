import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { currentSession, getRepo } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your project" };

/** Placeholder until Phase 7: shows only the signed-in customer's own project names and status. */
export default async function PortalPage() {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.role !== "customer" || !s.customerId) redirect("/");
  const projects = (await getRepo().list("projects")).filter((p) => p.customerIds?.includes(s.customerId!));
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3"><Logo className="h-10 w-10" /><div><p className="font-display text-xl font-semibold text-forest-900">Whispering Leaf</p><p className="text-sm text-stone-600">Hello {s.name.split(" ")[0]}</p></div></div>
      {projects.length === 0 ? <p className="card p-5">We haven’t set up a project for you yet.</p> : projects.map((p) => (
        <div key={p.id} className="card mb-3 p-5"><p className="font-medium">{p.name}</p><p className="text-sm text-stone-600">{p.status}</p></div>
      ))}
      <p className="mt-6 text-sm text-stone-500">Your full project portal (progress, documents and payments) is coming soon.</p>
    </main>
  );
}

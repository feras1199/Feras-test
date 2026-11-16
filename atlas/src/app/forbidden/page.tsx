import Link from "next/link";
export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-md p-6 text-center">
        <h1 className="h1">Not available for your role</h1>
        <p className="muted mt-2">Ask the owner if you need access to this area.</p>
        <Link href="/" className="btn-primary mt-6">Back to dashboard</Link>
      </div>
    </main>
  );
}

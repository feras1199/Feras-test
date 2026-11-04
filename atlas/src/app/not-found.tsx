import Link from "next/link";
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-md p-6 text-center">
        <h1 className="h1">Not found</h1>
        <p className="muted mt-2">That record doesn’t exist or was removed.</p>
        <Link href="/" className="btn-primary mt-6">Back to Today</Link>
      </div>
    </main>
  );
}

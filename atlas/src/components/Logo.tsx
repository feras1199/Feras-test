export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#1a4830" />
      <path d="M16 6c5.5 3.2 8 7.6 7 12.4-.8 3.8-3.6 6.4-7 7.6-3.4-1.2-6.2-3.8-7-7.6C8 13.6 10.5 9.2 16 6Z" fill="#c4a047" />
      <path d="M16 9v16" stroke="#1a4830" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 15l-3.5-2.5M16 19l4-3" stroke="#1a4830" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

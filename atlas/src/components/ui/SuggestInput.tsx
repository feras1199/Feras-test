"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { matchSuggestions } from "@/lib/domain/suggestions";

export interface SuggestOption {
  /** What goes in the box when picked. */
  value: string;
  /** What the list shows, if different (e.g. a full address). */
  label?: string;
}

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "list"> & {
  id: string;
  defaultValue?: string | null;
  /** Fixed options, filtered as the person types. */
  options?: readonly string[];
  /** Or options fetched for what's typed (addresses). */
  fetchOptions?: (typed: string) => Promise<SuggestOption[] | { options: SuggestOption[]; note?: string }>;
  /** Controlled use: the current value and a setter. */
  value?: string;
  onValueChange?: (v: string) => void;
  onPick?: (o: SuggestOption) => void;
  /** Small print under the list, e.g. who supplied the suggestions. */
  footer?: string;
  /** Show suggestions on focus before anything is typed. */
  showOnFocus?: boolean;
};

/**
 * A text box that suggests as you type. It is still a normal input (it submits by
 * its name and anything can be typed); the list just saves typing. Works with
 * tap, mouse, and arrow keys + Enter.
 */
export function SuggestInput({ id, defaultValue, options = [], fetchOptions, value: controlled, onValueChange, onPick, footer, showOnFocus = true, className, ...rest }: Props) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const value = controlled ?? own;
  const setValue = (v: string) => { if (controlled === undefined) setOwn(v); onValueChange?.(v); };
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [fetched, setFetched] = useState<SuggestOption[]>([]);
  const [note, setNote] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  const seq = useRef(0);

  // form.reset() clears normal inputs; do the same for this one.
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const reset = () => { setOwn(defaultValue ?? ""); setOpen(false); };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue]);

  useEffect(() => {
    if (!fetchOptions || !open) return;
    const n = ++seq.current;
    const t = window.setTimeout(async () => {
      try {
        const got = await fetchOptions(value);
        if (n === seq.current) { setFetched(Array.isArray(got) ? got : got.options); setNote(Array.isArray(got) ? "" : got.note ?? ""); }
      } catch (e) {
        if (n === seq.current) { setFetched([]); setNote((e as Error).message); }
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [fetchOptions, value, open]);

  const shown: SuggestOption[] = useMemo(
    () => (fetchOptions ? fetched : !value.trim() && !showOnFocus ? [] : matchSuggestions(options, value).map((v) => ({ value: v }))),
    [fetchOptions, fetched, options, value, showOnFocus],
  );
  const visible = open && (shown.length > 0 || !!note);

  function pick(o: SuggestOption) {
    setValue(o.value);
    onPick?.(o);
    setOpen(false);
    setHi(-1);
    setFetched([]);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible || !shown.length) { if (e.key === "ArrowDown") { setOpen(true); e.preventDefault(); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && hi >= 0 && shown[hi]) { e.preventDefault(); pick(shown[hi]!); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  return (
    <div className="relative">
      <input
        {...rest}
        ref={ref}
        id={id}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={visible && hi >= 0 ? `${listId}-${hi}` : undefined}
        className={className ?? "input"}
        onChange={(e) => { setValue(e.target.value); setOpen(true); setHi(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      {visible && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-card">
          <ul id={listId} role="listbox" aria-label="Suggestions">
            {shown.map((o, i) => (
              <li key={`${o.value}|${o.label ?? ""}`} id={`${listId}-${i}`} role="option" aria-selected={i === hi}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={`flex min-h-[44px] w-full items-center px-3 py-2 text-left text-sm ${i === hi ? "bg-forest-50" : "hover:bg-stone-50"}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                >
                  <span className="break-words">{o.label ?? o.value}</span>
                </button>
              </li>
            ))}
          </ul>
          {note && <p className="px-3 py-2 text-xs text-stone-600">{note}</p>}
          {footer && shown.length > 0 && <p className="border-t border-stone-100 px-3 py-1 text-right text-[11px] text-stone-500">{footer}</p>}
        </div>
      )}
    </div>
  );
}

/** Tap-to-add phrases for a longer box such as "What do they want done?". */
export function PhraseChips({ targetId, phrases, label = "Common jobs" }: { targetId: string; phrases: readonly string[]; label?: string }) {
  if (!phrases.length) return null;
  function add(p: string) {
    const el = document.getElementById(targetId) as HTMLTextAreaElement | HTMLInputElement | null;
    if (!el) return;
    const now = el.value.trim();
    if (now.toLowerCase().includes(p.toLowerCase())) return;
    const next = now ? `${now}${/[.,;]$/.test(now) ? "" : ","} ${p.charAt(0).toLowerCase()}${p.slice(1)}` : p;
    // Set the value the way React expects, so its onChange (if any) sees it.
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  }
  return (
    <div className="mt-2">
      <p className="mb-1 text-xs text-stone-500">{label}: tap to add</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {phrases.slice(0, 12).map((p) => (
          <button key={p} type="button" className="min-h-[36px] rounded-full border border-stone-300 bg-white px-3 text-sm hover:bg-stone-50" onClick={() => add(p)}>+ {p}</button>
        ))}
      </div>
    </div>
  );
}

/** Street address box with live suggestions. Picking one also hands back the suburb. */
export function AddressInput({ id, name, defaultValue, onSuburb, ...rest }: { id: string; name: string; defaultValue?: string | null; onSuburb?: (suburb: string) => void } & Omit<Props, "id" | "name" | "defaultValue" | "fetchOptions" | "options" | "onPick">) {
  const [footer, setFooter] = useState("");
  const fetchOptions = useMemo(
    () => async (typed: string) => {
      const t = typed.trim();
      if (!t) return [];
      // A house number alone can't be looked up yet.
      if (t.length < 4 || !/[a-z]{2}/i.test(t)) return { options: [], note: "Keep typing the street name to see addresses." };
      const res = await fetch(`/api/address/suggest?q=${encodeURIComponent(t)}`).catch(() => null);
      if (!res) throw new Error("No connection. Type the address in full.");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Address suggestions are unavailable. Type the address in full.");
      setFooter(json.attribution ?? "");
      const options = (json.suggestions as { label: string; street: string; suburb: string }[]).map((s) => ({ value: s.street, label: s.label, suburb: s.suburb }) as SuggestOption & { suburb: string });
      return options.length ? options : { options, note: "No matching address yet. Keep typing, or type it in full." };
    },
    [],
  );
  return (
    <SuggestInput
      {...rest}
      id={id}
      name={name}
      defaultValue={defaultValue}
      fetchOptions={fetchOptions}
      footer={footer}
      showOnFocus={false}
      onPick={(o) => { const s = (o as SuggestOption & { suburb?: string }).suburb; if (s) onSuburb?.(s); }}
      placeholder={rest.placeholder ?? "Start typing, e.g. 135 Phillip St"}
    />
  );
}

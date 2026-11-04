import { mailUrl, mapsUrl, telUrl, whatsappUrl } from "@/lib/domain/contact";

type Props = { phone?: string | null; email?: string | null; address?: string | null; suburb?: string | null; size?: "sm" | "md"; doNotContact?: boolean };

/** Call, WhatsApp, Email and Map buttons. Each only shows when there is something to link to. */
export function ContactButtons({ phone, email, address, suburb, size = "md", doNotContact }: Props) {
  const cls = `btn-secondary ${size === "sm" ? "!min-h-[36px] !px-3 text-xs" : ""}`;
  const tel = doNotContact ? null : telUrl(phone);
  const wa = doNotContact ? null : whatsappUrl(phone);
  const mail = doNotContact ? null : mailUrl(email);
  const map = mapsUrl(address, suburb);
  if (!tel && !wa && !mail && !map) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Contact">
      {tel && <a className={cls} href={tel}>Call</a>}
      {wa && <a className={cls} href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
      {mail && <a className={cls} href={mail}>Email</a>}
      {map && <a className={cls} href={map} target="_blank" rel="noreferrer">Map</a>}
    </div>
  );
}

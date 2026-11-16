import { describe, expect, it } from "vitest";
import { internationalAu, mailUrl, mapsUrl, telUrl, whatsappUrl } from "@/lib/domain/contact";

describe("contact links", () => {
  it("turns Australian numbers into WhatsApp and call links", () => {
    expect(whatsappUrl("0491 570 156")).toBe("https://wa.me/61491570156");
    expect(whatsappUrl("+61 491 570 156")).toBe("https://wa.me/61491570156");
    expect(whatsappUrl("(02) 9876 5432")).toBe("https://wa.me/61298765432");
    expect(telUrl("0491-570-156")).toBe("tel:+61491570156");
    expect(internationalAu("+64 21 123 4567")).toBe("64211234567");
    expect(whatsappUrl("")).toBeNull();
    expect(whatsappUrl("call me")).toBeNull();
  });
  it("only links real-looking emails and builds a Maps search", () => {
    expect(mailUrl("sam@example.com")).toBe("mailto:sam@example.com");
    expect(mailUrl("not an email")).toBeNull();
    expect(mapsUrl("12 Example Street", "Glenwood")).toBe("https://www.google.com/maps/search/?api=1&query=12%20Example%20Street%2C%20Glenwood%2C%20NSW%2C%20Australia");
    expect(mapsUrl(null, "")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { findDuplicates, normPhone, CustomerInput } from "@/lib/domain/customers";

const existing = [
  { id: "rec1", createdTime: "", name: "Alex Demo", email: "Alex.Demo@example.com", phone: "0491 570 001", address: "1 Example Street" },
  { id: "rec2", createdTime: "", name: "Sam Demo", email: "", phone: "", address: "22 Sample Avenue" },
] as never[];

describe("customer duplicates", () => {
  it("normalises Australian phone formats", () => {
    expect(normPhone("+61 491 570 001")).toBe("0491570001");
  });
  it("flags same email or phone as strong", () => {
    const d = findDuplicates({ name: "A. Demo", email: "alex.demo@EXAMPLE.com" }, existing);
    expect(d[0]).toMatchObject({ id: "rec1", strength: "strong" });
    expect(findDuplicates({ phone: "+61491570001" }, existing)[0]?.strength).toBe("strong");
  });
  it("flags same address as possible, ignoring street abbreviations", () => {
    expect(findDuplicates({ name: "New Person", address: "22 Sample Ave" }, existing)).toEqual([{ id: "rec2", name: "Sam Demo", reasons: ["same address"], strength: "possible" }]);
  });
  it("ignores the record being edited", () => {
    expect(findDuplicates({ email: "alex.demo@example.com" }, existing, "rec1")).toEqual([]);
  });
  it("validates input", () => {
    expect(CustomerInput.safeParse({ name: "X" }).success).toBe(false);
    expect(CustomerInput.safeParse({ name: "Jo Demo", email: "nope" }).success).toBe(false);
    expect(CustomerInput.parse({ name: " Jo Demo ", email: "" })).toEqual({ name: "Jo Demo" });
  });
});

import { describe, expect, it } from "vitest";
import { EnquiryUpdate, enquiryFlags } from "@/lib/domain/crm";

describe("enquiry flags", () => {
  const today = "2026-11-02";
  it("flags overdue follow-ups and stale contact", () => {
    expect(enquiryFlags({ status: "Proposal Sent", nextFollowUp: "2026-10-30", lastContactDate: "2026-10-20", enquiryDate: "2026-10-01" }, today)).toEqual(["Follow-up 3d overdue", "No contact for 13 days"]);
  });
  it("flags open enquiries with no follow-up date", () => {
    expect(enquiryFlags({ status: "Contacted", nextFollowUp: null, lastContactDate: today, enquiryDate: today }, today)).toEqual(["No follow-up date"]);
  });
  it("flags new enquiries nobody has contacted", () => {
    expect(enquiryFlags({ status: "New Enquiry", nextFollowUp: "2026-11-03", lastContactDate: null, enquiryDate: "2026-11-01" }, today)).toEqual(["Not contacted yet"]);
  });
  it("ignores closed enquiries", () => {
    expect(enquiryFlags({ status: "Lost", nextFollowUp: null, lastContactDate: null, enquiryDate: "2020-01-01" }, today)).toEqual([]);
  });
});

describe("enquiry updates", () => {
  it("requires a reason when marking lost", () => {
    expect(EnquiryUpdate.safeParse({ status: "Lost" }).success).toBe(false);
    expect(EnquiryUpdate.safeParse({ status: "Lost", reasonWonLost: "Price" }).success).toBe(true);
  });
  it("won't clear the follow-up on an open enquiry", () => {
    expect(EnquiryUpdate.safeParse({ status: "Contacted", nextFollowUp: null }).success).toBe(false);
  });
});

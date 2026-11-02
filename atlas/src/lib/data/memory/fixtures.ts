/**
 * FICTIONAL demo data. None of these people, addresses or numbers are real.
 * Names use the "Demo" surname, emails use example.com (reserved, RFC 2606)
 * and phone numbers use the 0491 570 xxx range ACMA reserves for fiction.
 */
import type { EntityName, Rec } from "../entities";

type Store = { [E in EntityName]?: Rec<E>[] };

function day(offset: number, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset));
  return d.toISOString().slice(0, 10);
}

const T = "2026-01-01T00:00:00.000Z";
const id = (prefix: string, n: number) => `rec${prefix}${String(n).padStart(14 - prefix.length, "0")}`;

export function buildFixtures(now = new Date()): Store {
  const D = (o: number) => day(o, now);
  const cust = (n: number) => id("DemoCust", n);
  const enq = (n: number) => id("DemoEnq", n);
  const proj = (n: number) => id("DemoProj", n);
  const comp = (n: number) => id("DemoComp", n);
  const est = (n: number) => id("DemoEst", n);

  return {
    customers: [
      { id: cust(1), createdTime: T, name: "Alex Demo", phone: "0491 570 001", email: "alex.demo@example.com", address: "1 Example Street", suburb: "Castle Hill", preferredContact: "Phone", customerType: "Family", leadSource: "Google", leadStatus: "Site Visit Booked", enquiryDate: D(-6), nextFollowUp: D(1), nextFollowUpAction: "Confirm site visit time", lastContactDate: D(-2), doNotContact: false, projectIds: [], enquiryIds: [enq(1)] },
      { id: cust(2), createdTime: T, name: "Sam & Jo Demo", phone: "0491 570 002", email: "samjo.demo@example.com", address: "22 Sample Avenue", suburb: "Baulkham Hills", preferredContact: "Email", customerType: "Couple", leadSource: "Referral", leadStatus: "Proposal Sent", enquiryDate: D(-20), nextFollowUp: D(-1), nextFollowUpAction: "Follow up on proposal", lastContactDate: D(-8), doNotContact: false, projectIds: [proj(2)], enquiryIds: [enq(2)] },
      { id: cust(3), createdTime: T, name: "Taylor Demo", phone: "0491 570 003", email: "taylor.demo@example.com", address: "7 Placeholder Road", suburb: "Kellyville", preferredContact: "SMS", customerType: "Single", leadSource: "Website", leadStatus: "Project Active", enquiryDate: D(-60), lastContactDate: D(-1), doNotContact: false, projectIds: [proj(1)], enquiryIds: [enq(3)] },
      { id: cust(4), createdTime: T, name: "Jordan Demo", phone: "0491 570 004", email: "jordan.demo@example.com", address: "15 Fictional Close", suburb: "Rouse Hill", preferredContact: "Phone", customerType: "Family", leadSource: "Meta Advertising", leadStatus: "New Enquiry", enquiryDate: D(0), doNotContact: false, projectIds: [], enquiryIds: [enq(4)] },
    ],
    enquiries: [
      { id: enq(1), createdTime: T, title: "Alex Demo – backyard paving and turf", customerIds: [cust(1)], enquiryDate: D(-6), leadSource: "Google", serviceRequested: "Paving and new turf, about 60 m²", budget: 2_000_000, status: "Site Visit Booked", assignedTo: "Owner", nextAction: "Site visit", nextFollowUp: D(1), lastContactDate: D(-2), leadQuality: "High", leadAtRisk: false },
      { id: enq(2), createdTime: T, title: "Sam & Jo Demo – sandstone retaining wall", customerIds: [cust(2)], projectIds: [proj(2)], enquiryDate: D(-20), leadSource: "Referral", serviceRequested: "Retaining wall along rear boundary", budget: 3_500_000, status: "Proposal Sent", assignedTo: "Owner", nextAction: "Follow up on proposal", nextFollowUp: D(-1), lastContactDate: D(-8), leadQuality: "Medium", leadAtRisk: true },
      { id: enq(3), createdTime: T, title: "Taylor Demo – front yard makeover", customerIds: [cust(3)], projectIds: [proj(1)], enquiryDate: D(-60), leadSource: "Website", serviceRequested: "Front yard paving, garden beds and lighting", budget: 4_000_000, status: "Won", assignedTo: "Owner", leadQuality: "High", leadAtRisk: false },
      { id: enq(4), createdTime: T, title: "Jordan Demo – concrete driveway", customerIds: [cust(4)], enquiryDate: D(0), leadSource: "Meta Advertising", serviceRequested: "Replace cracked concrete driveway", status: "New Enquiry", leadQuality: "Unknown", leadAtRisk: false },
    ],
    projects: [
      { id: proj(1), createdTime: T, name: "Taylor Demo – Front Yard", serviceType: "Landscaping", status: "In Progress", estValue: 3_850_000, startDate: D(-10), completionDate: D(12), customerIds: [cust(3)], componentIds: [comp(1), comp(2), comp(3)], siteAddress: "7 Placeholder Road", suburb: "Kellyville", progress: 0.45, health: "On Track", projectManager: "Owner", nextAction: "Lay pavers in zone A", nextActionDate: D(1), priority: "Normal", dataMode: "Practice", estimateIds: [est(1)] },
      { id: proj(2), createdTime: T, name: "Sam & Jo Demo – Retaining Wall", serviceType: "Retaining Wall", status: "Proposed", estValue: 3_190_000, customerIds: [cust(2)], componentIds: [comp(4)], siteAddress: "22 Sample Avenue", suburb: "Baulkham Hills", health: "On Track", priority: "High", dataMode: "Practice", estimateIds: [est(2)] },
    ],
    components: [
      { id: comp(1), createdTime: T, label: "Taylor Demo – Front Yard · Paving", projectIds: [proj(1)], componentType: "Paving", status: "Active", zone: "Front path and entry", quotedRevenue: 1_950_000, estimatedCost: 1_500_000, estimatedHours: 96, estimatedDays: 4, unitemisedCostAdj: 0, unitemisedHoursAdj: 0 },
      { id: comp(2), createdTime: T, label: "Taylor Demo – Front Yard · Planting", projectIds: [proj(1)], componentType: "Planting", status: "Completed", zone: "Garden beds", quotedRevenue: 650_000, finalRevenue: 650_000, estimatedCost: 500_000, estimatedHours: 32, estimatedDays: 2, actualDays: 2, unitemisedCostAdj: 0, unitemisedHoursAdj: 0 },
      { id: comp(3), createdTime: T, label: "Taylor Demo – Front Yard · Lighting", projectIds: [proj(1)], componentType: "Lighting", status: "Won", zone: "Path lighting", quotedRevenue: 900_000, estimatedCost: 690_000, estimatedHours: 24, estimatedDays: 2, unitemisedCostAdj: 0, unitemisedHoursAdj: 0 },
      { id: comp(4), createdTime: T, label: "Sam & Jo Demo – Retaining Wall · Retaining Wall", projectIds: [proj(2)], componentType: "Retaining Wall", status: "Quoted", zone: "Rear boundary", quotedRevenue: 2_900_000, estimatedCost: 2_230_000, estimatedHours: 140, estimatedDays: 6, unitemisedCostAdj: 0, unitemisedHoursAdj: 0 },
    ],
    estimates: [
      { id: est(1), createdTime: T, title: "Q-DEMO-001 Taylor Demo – Front Yard", customerIds: [cust(3)], projectIds: [proj(1)], enquiryIds: [enq(3)], estimateDate: D(-30), status: "Accepted", estimateType: "Formal Quote", pricingBasis: "Net costs + GST", quoteNumber: "Q-DEMO-001", agreedPriceExGst: 3_500_000, customerTotalIncGst: 3_850_000, acceptedDate: D(-15), quoteLocked: true, revision: 1 },
      { id: est(2), createdTime: T, title: "Q-DEMO-002 Sam & Jo Demo – Retaining Wall", customerIds: [cust(2)], projectIds: [proj(2)], enquiryIds: [enq(2)], estimateDate: D(-10), status: "Quoted", estimateType: "Formal Quote", pricingBasis: "Net costs + GST", quoteNumber: "Q-DEMO-002", agreedPriceExGst: 2_900_000, customerTotalIncGst: 3_190_000, sentDate: D(-8), validUntil: D(22), quoteLocked: true, revision: 1 },
    ],
    payments: [
      { id: id("DemoPay", 1), createdTime: T, title: "Q-DEMO-001 Deposit", projectIds: [proj(1)], stageLabel: "Deposit", stageRate: 0.1, amount: 385_000, contractSnapshot: 3_850_000, dueDate: D(-14), receivedDate: D(-13), status: "Paid", paymentMethod: "Bank Transfer", archived: false },
      { id: id("DemoPay", 2), createdTime: T, title: "Q-DEMO-001 Progress 1", projectIds: [proj(1)], stageLabel: "Progress 1 – site prepared", stageRate: 0.3, amount: 1_155_000, contractSnapshot: 3_850_000, dueDate: D(-2), status: "Due", archived: false },
      { id: id("DemoPay", 3), createdTime: T, title: "Q-DEMO-001 Progress 2", projectIds: [proj(1)], stageLabel: "Progress 2 – paving laid", stageRate: 0.3, amount: 1_155_000, contractSnapshot: 3_850_000, dueDate: D(7), status: "Pending", archived: false },
      { id: id("DemoPay", 4), createdTime: T, title: "Q-DEMO-001 Progress 3", projectIds: [proj(1)], stageLabel: "Progress 3 – planting and lighting", stageRate: 0.2, amount: 770_000, contractSnapshot: 3_850_000, dueDate: D(12), status: "Pending", archived: false },
      { id: id("DemoPay", 5), createdTime: T, title: "Q-DEMO-001 Final", projectIds: [proj(1)], stageLabel: "Final – practical completion", stageRate: 0.1, amount: 385_000, contractSnapshot: 3_850_000, dueDate: D(14), status: "Pending", archived: false },
    ],
    actualCosts: [
      { id: id("DemoCost", 1), createdTime: T, title: "Pavers – Demo Supplies Pty Ltd", projectIds: [proj(1)], componentIds: [comp(1)], costType: "Material", supplier: "Demo Supplies Pty Ltd", quantity: 1, unitCostInc: 660_000, costDate: D(-8), reference: "INV-D-1001", reviewed: true, unplanned: false, marketingCost: false },
      { id: id("DemoCost", 2), createdTime: T, title: "Plants – Example Nursery", projectIds: [proj(1)], componentIds: [comp(2)], costType: "Material", supplier: "Example Nursery", quantity: 1, unitCostInc: 275_000, costDate: D(-6), reference: "EN-2201", reviewed: true, unplanned: false, marketingCost: false },
      { id: id("DemoCost", 3), createdTime: T, title: "Skip bin", projectIds: [proj(1)], componentIds: [], costType: "Disposal", supplier: "Sample Skips", quantity: 1, unitCostInc: 49_500, costDate: D(-5), reference: "", reviewed: false, unplanned: true, marketingCost: false },
    ],
    timesheets: [
      { id: id("DemoTime", 1), createdTime: T, title: "Crew – planting", projectIds: [proj(1)], componentIds: [comp(2)], staffName: "Demo Crew", workDate: D(-6), start: `${D(-6)}T07:00:00.000Z`, finish: `${D(-6)}T15:30:00.000Z`, breakMinutes: 30, rate: 4_500, rateBasis: "Per Person", crewSize: 2, workType: "Construction", submitted: true },
      { id: id("DemoTime", 2), createdTime: T, title: "Crew – planting day 2", projectIds: [proj(1)], componentIds: [comp(2)], staffName: "Demo Crew", workDate: D(-5), start: `${D(-5)}T07:00:00.000Z`, finish: `${D(-5)}T15:30:00.000Z`, breakMinutes: 30, rate: 4_500, rateBasis: "Per Person", crewSize: 2, workType: "Construction", submitted: true },
      { id: id("DemoTime", 3), createdTime: T, title: "Crew – paving prep", projectIds: [proj(1)], componentIds: [comp(1)], staffName: "Demo Crew", workDate: D(-1), start: `${D(-1)}T07:00:00.000Z`, finish: `${D(-1)}T15:00:00.000Z`, breakMinutes: 30, rate: 4_500, rateBasis: "Per Person", crewSize: 3, workType: "Construction", submitted: false },
    ],
    tasks: [
      { id: id("DemoTask", 1), createdTime: T, title: "Call Sam & Jo about the retaining wall proposal", customerIds: [cust(2)], enquiryIds: [enq(2)], assignedTo: "Owner", status: "Today", priority: "High", dueDate: D(-1), taskType: "Lead Follow-up", needsAttention: true },
      { id: id("DemoTask", 2), createdTime: T, title: "Site visit – Alex Demo", customerIds: [cust(1)], enquiryIds: [enq(1)], assignedTo: "Owner", status: "Backlog", priority: "Normal", dueDate: D(1), taskType: "Site Visit", needsAttention: false },
      { id: id("DemoTask", 3), createdTime: T, title: "Order lighting kit for Taylor Demo", projectIds: [proj(1)], assignedTo: "Supervisor", status: "Doing", priority: "Normal", dueDate: D(2), taskType: "Material / Supplier", needsAttention: false },
    ],
    variations: [
      { id: id("DemoVar", 1), createdTime: T, title: "Extra garden bed edging", projectIds: [proj(1)], componentIds: [comp(2)], requestedBy: "Customer", requestDate: D(-4), description: "Customer asked for steel edging on the second bed", estimatedCost: 60_000, customerPrice: 85_800, scheduleImpactDays: 0, status: "Sent for Approval", customerApproved: false, revenueApplied: false, costApplied: false },
    ],
  };
}

import { describe, expect, it } from "vitest";
import { applySettingsEdit, DEFAULT_SETTINGS, resolveSettings, SettingsEdit, settingsChanges, type Settings } from "@/lib/config/settings";
import { settingsForEstimate } from "@/lib/domain/estimates";

const editOf = (s: Settings) => SettingsEdit.parse({ business: { name: s.business.name, abn: s.business.abn, licenceNumber: s.business.licenceNumber, phone: s.business.phone, email: s.business.email }, pricing: s.pricing, commission: s.commission, payments: s.payments, labour: s.labour });

describe("owner settings edits", () => {
  it("applies a valid edit and keeps the timezone", () => {
    const e = editOf(DEFAULT_SETTINGS);
    e.pricing.defaultMarkup = 0.35;
    e.labour.defaultRatePerPersonHourCents = 5200;
    const next = applySettingsEdit({ ...DEFAULT_SETTINGS, business: { ...DEFAULT_SETTINGS.business, timezone: "Australia/Perth" } }, e);
    expect(next.pricing.defaultMarkup).toBe(0.35);
    expect(next.labour.defaultRatePerPersonHourCents).toBe(5200);
    expect(next.business.timezone).toBe("Australia/Perth");
  });

  it("rejects schedules that don't total 100%, a missing default and an upside-down margin band", () => {
    const a = editOf(DEFAULT_SETTINGS);
    a.payments.schedules.fiveStage!.stages[0]!.rate = 0.2;
    expect(() => applySettingsEdit(DEFAULT_SETTINGS, a)).toThrow(/not 100%/);
    const b = editOf(DEFAULT_SETTINGS);
    b.payments.defaultSchedule = "nope";
    expect(() => applySettingsEdit(DEFAULT_SETTINGS, b)).toThrow(/default payment schedule/);
    const c = editOf(DEFAULT_SETTINGS);
    c.pricing.minMargin = 0.5;
    expect(() => applySettingsEdit(DEFAULT_SETTINGS, c)).toThrow(/lowest margin/);
  });

  it("refuses out-of-range values at the input check", () => {
    const e = editOf(DEFAULT_SETTINGS) as unknown as { pricing: { gstRate: number } };
    e.pricing.gstRate = 10; // 1000%: someone typed a percent where a rate goes
    expect(() => SettingsEdit.parse(e)).toThrow();
  });

  it("lists exactly what changed for the audit log", () => {
    const e = editOf(DEFAULT_SETTINGS);
    e.pricing.gstRate = 0.15;
    const next = applySettingsEdit(DEFAULT_SETTINGS, e);
    expect(settingsChanges(DEFAULT_SETTINGS, next)).toEqual([{ path: "pricing.gstRate", from: 0.1, to: 0.15 }]);
  });
});

describe("approved quotes are not repriced", () => {
  const startUp = resolveSettings({});
  const changed: Settings = { ...startUp, pricing: { ...startUp.pricing, defaultMarkup: 0.5, gstRate: 0.15 } };

  it("drafts use the current settings", () => {
    expect(settingsForEstimate({ quoteLocked: false }, changed, startUp).pricing.defaultMarkup).toBe(0.5);
  });
  it("a locked quote uses the rules saved in its snapshot", () => {
    const rules = { pricing: { ...startUp.pricing, defaultMarkup: 0.25 }, commission: startUp.commission, maxDepositRate: 0.1 };
    const s = settingsForEstimate({ quoteLocked: true, snapshotJson: JSON.stringify({ rules }) }, changed, startUp);
    expect(s.pricing.defaultMarkup).toBe(0.25);
    expect(s.pricing.gstRate).toBe(0.1);
  });
  it("a locked quote from before snapshots carried rules uses the start-up settings", () => {
    const s = settingsForEstimate({ quoteLocked: true, snapshotJson: JSON.stringify({ version: 1 }) }, changed, startUp);
    expect(s.pricing.defaultMarkup).toBe(startUp.pricing.defaultMarkup);
    expect(s.pricing.gstRate).toBe(0.1);
  });
});

describe("common tasks list", () => {
  it("defaults to the manager's list and old stored settings without it still load", () => {
    expect(DEFAULT_SETTINGS.lists.taskTitles).toContain("Site Visit");
    const { lists: _drop, ...old } = DEFAULT_SETTINGS;
    expect(resolveSettings(old).lists.taskTitles).toEqual(DEFAULT_SETTINGS.lists.taskTitles);
  });
  it("owner edits are trimmed and de-duplicated; leaving lists out keeps the current ones", () => {
    const e = SettingsEdit.parse({ ...editOf(DEFAULT_SETTINGS), lists: { taskTitles: [" Site Visit ", "site visit", "", "Order  pavers"] } });
    const next = applySettingsEdit(DEFAULT_SETTINGS, e);
    expect(next.lists.taskTitles).toEqual(["Site Visit", "Order pavers"]);
    expect(applySettingsEdit(next, editOf(DEFAULT_SETTINGS)).lists.taskTitles).toEqual(["Site Visit", "Order pavers"]);
  });
});

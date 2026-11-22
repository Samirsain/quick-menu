import { test } from "node:test";
import assert from "node:assert/strict";
import { salesReport, hourLabel, rangeStart, type ReportOrder } from "./reports.ts";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 22, h, m)).toISOString();
const utcHour = (d: Date) => d.getUTCHours();
const order = (o: Partial<ReportOrder> & { lines: [string, number, number][] }): ReportOrder => ({
  id: o.id || Math.random().toString(36),
  status: o.status || "completed",
  created_at: o.created_at || at(13),
  table_number: o.table_number || "1",
  seating_id: o.seating_id,
  items: { items: o.lines.map(([name, price, quantity]) => ({ name, price, quantity })), timeline: o.items?.timeline },
});

test("sales, bills, bestsellers, peak hour and tables", () => {
  const r = salesReport([
    order({ seating_id: "s1", table_number: "7", created_at: at(13), lines: [["Paneer Tikka", 249, 2], ["Naan", 60, 3]] }),
    order({ seating_id: "s1", table_number: "7", created_at: at(13, 30), lines: [["Lassi", 120, 1]] }),
    order({ seating_id: "s2", table_number: "3", created_at: at(20), lines: [["Naan", 60, 4]] }),
    order({ status: "rejected", lines: [["Paneer Tikka", 249, 10]] }),
    order({ status: "cancelled", lines: [["Naan", 60, 10]] }),
  ], [], utcHour);
  assert.equal(r.sales, 498 + 180 + 120 + 240);
  assert.equal(r.orders, 3);
  assert.equal(r.bills, 2);
  assert.equal(r.avgBill, Math.round(1038 / 2));
  assert.equal(r.voided, 2);
  assert.deepEqual(r.items[0], { name: "Naan", qty: 7, revenue: 420 });
  assert.equal(r.items[1].name, "Paneer Tikka");
  assert.equal(r.peakHour, 13);
  assert.equal(r.hours[13].orders, 2);
  assert.deepEqual(r.tables.map(t => t.table), ["7", "3"]);
});

test("kitchen time, payment modes and tips (confirmed only)", () => {
  const r = salesReport(
    [order({ created_at: at(12), items: { timeline: { ready: at(12, 18) } }, lines: [["Thali", 300, 1]] }),
     order({ created_at: at(12), items: { timeline: { ready: at(12, 12) } }, lines: [["Thali", 300, 1]] })],
    [{ amount: 300, tip: 30, mode: "upi", status: "confirmed" }, { amount: 300, mode: "cash", status: "confirmed" },
     { amount: 500, tip: 50, mode: "upi", status: "pending" }],
    utcHour,
  );
  assert.equal(r.kitchenMinutes, 15);
  assert.deepEqual(r.payModes, [{ mode: "upi", amount: 300 }, { mode: "cash", amount: 300 }]);
  assert.equal(r.tips, 30);
});

test("empty day", () => {
  const r = salesReport([]);
  assert.deepEqual([r.sales, r.orders, r.avgBill, r.peakHour, r.kitchenMinutes], [0, 0, 0, null, null]);
});

test("labels and ranges", () => {
  assert.deepEqual([0, 9, 12, 19].map(hourLabel), ["12 AM", "9 AM", "12 PM", "7 PM"]);
  const now = new Date(2026, 10, 22, 15, 30);
  assert.equal(rangeStart("today", now).getTime(), new Date(2026, 10, 22).getTime());
  assert.equal(rangeStart("7d", now).getTime(), new Date(2026, 10, 16).getTime());
  assert.equal(rangeStart("30d", now).getTime(), new Date(2026, 9, 24).getTime());
});

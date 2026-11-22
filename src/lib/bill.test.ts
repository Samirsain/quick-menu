// npm test   (node --test, no extra packages)
// Same menu and rates as supabase/tests/v2_check.sql, so the phone and the database agree on every rupee.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBill, splitEqual, equalShare, itemsShare, tipFor, clampAmount, unclaimed, floorStatus } from "./bill.ts";

const lines = [
  { price: 249, quantity: 2 }, // Paneer Tikka
  { price: 75, quantity: 3 },  // Butter Naan + Butter
  { price: 120, quantity: 1 }, // Lassi (Large)
];
const rates = { gstRate: 5, servicePct: 10 };
const FLAT10 = { kind: "pct" as const, value: 10 };

test("bill matches seating_bill(): 843 -> FLAT10 -> service -> GST -> 876", () => {
  const b = computeBill(lines, { ...rates, discount: FLAT10 });
  assert.deepEqual(
    { subtotal: b.subtotal, discount: b.discount, service: b.service, gst: b.gst, total: b.total, due: b.due },
    { subtotal: 843, discount: 84.3, service: 75.87, gst: 41.73, total: 876, due: 876 },
  );
  assert.equal(computeBill(lines, rates).total, Math.round(843 * 1.1 * 1.05)); // no discount: 974
});

test("discount respects min bill and flat discounts never go below zero", () => {
  assert.equal(computeBill(lines, { ...rates, discount: { kind: "flat", value: 500, min_bill: 5000 } }).discount, 0);
  assert.equal(computeBill([{ price: 100 }], { gstRate: 0, servicePct: 0, discount: { kind: "flat", value: 500 } }).total, 0);
  assert.equal(computeBill([], rates).total, 0);
});

test("payments: confirmed count as paid, pending is held back, tips stay separate", () => {
  const b = computeBill(lines, { ...rates, discount: FLAT10, payments: [
    { amount: 292, tip: 29, status: "confirmed" },
    { amount: 292, status: "pending" },
    { amount: 999, status: "rejected" },
  ] });
  assert.deepEqual([b.paid, b.pending, b.tips, b.due, unclaimed(b)], [292, 292, 29, 584, 292]);
});

test("equal split always adds up to the bill", () => {
  assert.deepEqual(splitEqual(876, 3), [292, 292, 292]);
  assert.deepEqual(splitEqual(877, 3), [293, 292, 292]);
  assert.deepEqual(splitEqual(878, 3), [293, 293, 292]);
  assert.deepEqual(splitEqual(2706, 3), [902, 902, 902]); // reel: ₹2,706 · 3 guests
  assert.deepEqual(splitEqual(100.5, 2), [50.5, 50]);
  assert.deepEqual(splitEqual(10, 0), [10]);
  for (const [amt, n] of [[999.99, 7], [1, 4], [5000, 13], [0.5, 3]] as const) {
    const s = splitEqual(amt, n);
    assert.equal(Math.round(s.reduce((a, b) => a + b, 0) * 100), Math.round(amt * 100), `${amt}/${n}`);
  }
});

test("each guest gets the next share, capped at what's still unclaimed", () => {
  assert.equal(equalShare({ total: 877, due: 877, pending: 0 }, 3, 0), 293);
  assert.equal(equalShare({ total: 877, due: 584, pending: 0 }, 3, 1), 292);
  assert.equal(equalShare({ total: 877, due: 100, pending: 0 }, 3, 2), 100);
});

test("pay for your items: proportional share including tax and discount", () => {
  const bill = computeBill(lines, { ...rates, discount: FLAT10 });
  // 2 paneer = 498 of 843 -> 498/843 of 876 = 517.49 -> 517
  assert.equal(itemsShare(bill, [{ price: 249, quantity: 2 }]), 517);
  assert.equal(itemsShare(bill, lines), 876);
  assert.equal(itemsShare({ ...bill, pending: 800 }, lines), 76);
  assert.equal(itemsShare({ subtotal: 0, total: 0, due: 0, pending: 0 }, lines), 0);
});

test("tips and typed amounts", () => {
  assert.equal(820 + tipFor(820, 10), 902); // reel
  assert.equal(tipFor(292, 10), 29);
  assert.equal(tipFor(292, 15), 44);
  assert.equal(tipFor(292, 0), 0);
  const due = { due: 876, pending: 0 };
  assert.equal(clampAmount("500", due), 500);
  assert.equal(clampAmount("₹1,000", due), 876);
  assert.equal(clampAmount("12.999", due), 12.99);
  assert.equal(clampAmount("abc", due), 0);
  assert.equal(clampAmount("", due), 0);
});

test("floor status", () => {
  const bill = { due: 876, pending: 0, total: 876 };
  assert.equal(floorStatus(null, null), "free");
  assert.equal(floorStatus({ needs_cleaning: true }, null), "cleaning");
  assert.equal(floorStatus({}, { orders: [], bill: { due: 0, pending: 0, total: 0 } }), "open");
  assert.equal(floorStatus({}, { orders: [{ status: "preparing" }], bill }), "ordered");
  assert.equal(floorStatus({}, { orders: [{ status: "completed" }], bill }), "bill");
  assert.equal(floorStatus({}, { orders: [{ status: "preparing" }], bill: { ...bill, pending: 292 } }), "bill");
  assert.equal(floorStatus({}, { orders: [{ status: "preparing" }], bill }, [{ call_type: "bill", status: "pending" }]), "bill");
  assert.equal(floorStatus({}, { orders: [{ status: "cancelled" }], bill: { due: 0, pending: 0, total: 0 } }), "open");
});

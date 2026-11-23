// The ZenCafe demo's table service: no database, everything on this device.
// It plays the other side of the restaurant so a demo runs end to end like the reel:
// the kitchen moves orders along, "Rahul" answers calls, the cashier confirms payments.
// Statuses are worked out from timestamps on every read, so there are no timers to leak and a reload keeps the story.
import { getMockMenuItems } from "@/data/mockRestaurants";
import { computeBill } from "@/lib/bill";
import { TableError, type CallReason, type SeatCall, type SeatOrder, type SeatPayment, type SpinPrize, type TableApi, type TableState } from "@/lib/tableService";

const KEY = "qm_demo_seat_v2";
const WAITER = "Rahul";
const RATES = { gstRate: 5, servicePct: 0 };
const COUPONS: Record<string, { kind: "pct" | "flat"; value: number; min_bill: number; label: string }> = {
  FLAT10: { kind: "pct", value: 10, min_bill: 0, label: "10% off" },
  WELCOME50: { kind: "flat", value: 50, min_bill: 300, label: "₹50 off" },
};
export const DEMO_PRIZES: SpinPrize[] = [
  { label: "Free cookie", kind: "item" },
  { label: "10% off", kind: "pct", value: 10 },
  { label: "Try again", kind: "none" },
  { label: "Free coffee", kind: "item" },
  { label: "₹50 off", kind: "flat", value: 50 },
  { label: "Free dessert", kind: "item" },
];
const LOYALTY = { enabled: true, rupees_per_point: 10, goal: 200, reward: "Free coffee" };
const DEMO_POINTS = 120; // a returning guest, so the progress bar has something to show

interface DemoSeat {
  key: string; table: string; opened_at: string; closed_at: string | null;
  orders: SeatOrder[]; payments: SeatPayment[]; calls: SeatCall[];
  discount: TableState["discount"]; spin: SpinPrize | null; phone: string | null;
  orderNo: number;
}

const now = () => Date.now();
const iso = (t = now()) => new Date(t).toISOString();
const since = (at: string) => (now() - new Date(at).getTime()) / 1000;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${now()}-${Math.random().toString(16).slice(2)}`);

function load(): DemoSeat | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function save(s: DemoSeat) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: the demo still runs for this page */ }
}
function seatFor(key: string, open = true): DemoSeat {
  const s = load();
  if (!s || s.key !== key) throw new TableError("seat_closed");
  if (open && settle(s).closed_at) throw new TableError("seat_closed");
  return s;
}

// The pretend kitchen, waiter and cashier
const orderStatus = (o: SeatOrder) => {
  if (o.status === "cancelled") return "cancelled";
  const t = since(o.created_at);
  return t < 6 ? "pending" : t < 12 ? "accepted" : t < 35 ? "preparing" : t < 50 ? "ready" : "completed";
};
const at = (o: SeatOrder, sec: number) => iso(new Date(o.created_at).getTime() + sec * 1000);

function settle(s: DemoSeat): DemoSeat & { view: TableState } {
  const orders = s.orders.map(o => {
    const status = orderStatus(o);
    const steps: [string, number][] = [["accepted", 6], ["preparing", 12], ["ready", 35], ["completed", 50]];
    const timeline = { ...(o.items?.timeline || {}) };
    if (status !== "cancelled") for (const [k, sec] of steps) if (since(o.created_at) >= sec) timeline[k as "ready"] = at(o, sec);
    return { ...o, status, items: { ...o.items, timeline } };
  });
  const payments = s.payments.map(p => (p.status === "pending" && since(p.created_at) > 5 ? { ...p, status: "confirmed" as const } : p));
  const calls = s.calls.map(c => {
    const t = since(c.created_at);
    if (t < 4) return c;
    return { ...c, status: (t < 34 ? "acknowledged" : "completed") as SeatCall["status"], acknowledged_by: WAITER,
             acknowledged_at: iso(new Date(c.created_at).getTime() + 4000) };
  });
  const lines = orders.filter(o => o.status !== "cancelled").flatMap(o => o.items?.items || []);
  const bill = computeBill(lines, { ...RATES, discount: s.discount, payments });
  if (!s.closed_at && bill.total > 0 && bill.due === 0) {
    s.closed_at = iso();
    save(s);
  }
  const closedPoints = s.closed_at && s.phone ? Math.floor(bill.paid / LOYALTY.rupees_per_point) : 0;
  const view: TableState = {
    ok: true,
    status: s.closed_at ? "closed" : "open",
    table: s.table,
    bill_table: s.table,
    opened_at: s.opened_at,
    closed_at: s.closed_at,
    orders,
    bill,
    payments,
    calls: [...calls].reverse().slice(0, 5),
    served_by: calls.some(c => c.acknowledged_by) || orders.some(o => o.status === "completed") ? WAITER : null,
    discount: s.discount,
    spin: s.spin,
    spin_prizes: DEMO_PRIZES,
    loyalty: { ...LOYALTY, phone_linked: !!s.phone, points: s.phone ? DEMO_POINTS + closedPoints : null },
    wifi: { ssid: "ZenCafe_Guest", password: "mindful2026" },
  };
  return { ...s, view };
}

export const demoTable: TableApi = {
  demo: true,

  async join(table) {
    let s = load();
    if (!s || s.table !== table || settle(s).closed_at || !s.opened_at) s = newSeat(table);
    save(s);
    return { ok: true, key: s.key, table };
  },

  async state(key) {
    const s = load();
    if (!s || s.key !== key || !s.opened_at) return null;
    const v = settle(s);
    if (v.closed_at && now() - new Date(v.closed_at).getTime() > 3 * 3600_000) return null;
    return v.view;
  },

  async placeOrder(key, lines, note, clientId) {
    const s = seatFor(key);
    const existing = s.orders.find(o => o.id === clientId);
    if (existing) return existing;
    if (s.orders.filter(o => orderStatus(o) === "pending").length >= 5) throw new TableError("too_many");
    const menu = getMockMenuItems();
    const items = lines.map(l => {
      const m = menu.find(x => x.id === l.id);
      if (!m) throw new TableError("item_gone");
      if (!m.is_available) throw new TableError("item_unavailable", m.name);
      let price = m.price;
      let size: string | null = null;
      if (m.has_size_variants && m.size_variants.length) {
        const v = m.size_variants.find(x => x.name === l.size);
        if (!v) throw new TableError("bad_size");
        price = v.price;
        size = v.name;
      }
      const addons = [...new Set(l.addons || [])].map(name => {
        const a = (m.addons || []).find(x => x.name === name);
        if (!a) throw new TableError("bad_addon");
        price += a.price;
        return a.name;
      });
      const opts = [...addons, (l.note || "").trim().slice(0, 120)].filter(Boolean).join(" · ");
      return { id: m.id, name: m.name, price, quantity: l.qty, image_url: m.image_url, selectedSize: size, options: opts || null, prep_minutes: m.prep_minutes ?? null };
    });
    s.orderNo += 1;
    const t = iso();
    const order: SeatOrder = {
      id: clientId, order_number: `ORD${String(s.orderNo).padStart(4, "0")}`, table_number: s.table, status: "pending",
      items: { items, note: note?.trim().slice(0, 200) || null, timeline: { pending: t } }, created_at: t, updated_at: t,
    };
    s.orders.push(order);
    save(s);
    return order;
  },

  async cancelOrder(key, orderId) {
    const s = seatFor(key);
    const o = s.orders.find(x => x.id === orderId);
    if (!o || orderStatus(o) !== "pending") throw new TableError("not_editable");
    o.status = "cancelled";
    save(s);
  },

  async callStaff(key, reason: CallReason) {
    const s = seatFor(key);
    const last = s.calls[s.calls.length - 1];
    if (last && since(last.created_at) < 30) throw new TableError("too_soon");
    s.calls.push({ id: uid(), call_type: reason, status: "pending", acknowledged_by: null, acknowledged_at: null, created_at: iso() });
    save(s);
  },

  async pay(key, p) {
    const s = seatFor(key);
    const { view } = settle(s);
    const left = view.bill.due - view.bill.pending;
    if (!(p.amount > 0) || p.amount > left + 0.001) throw new TableError("over_due");
    if (p.tip < 0 || p.tip > p.amount) throw new TableError("bad_tip");
    s.payments = view.payments;
    s.payments.push({ id: uid(), payer: p.payer.trim().slice(0, 40), amount: Math.round(p.amount * 100) / 100, tip: Math.round(p.tip),
                      mode: p.mode, split: p.split, status: "pending", created_at: iso() });
    save(s);
  },

  async applyCoupon(key, code) {
    const s = seatFor(key);
    const c = COUPONS[code.trim().toUpperCase()];
    if (!c) throw new TableError("bad_code");
    const { view } = settle(s);
    if (view.bill.paid > 0 || view.bill.pending > 0) throw new TableError("already_paying");
    if (view.bill.subtotal < c.min_bill) throw new TableError("min_bill", String(c.min_bill));
    s.discount = { code: code.trim().toUpperCase(), ...c };
    save(s);
  },

  async spin(key) {
    const s = seatFor(key);
    if (s.spin) return s.spin;
    if (!s.orders.some(o => o.status !== "cancelled")) throw new TableError("order_first");
    const index = Math.floor(Math.random() * DEMO_PRIZES.length);
    s.spin = { ...DEMO_PRIZES[index], index };
    if (!s.discount && (s.spin.kind === "pct" || s.spin.kind === "flat") && s.spin.value) {
      s.discount = { code: "SPIN", kind: s.spin.kind, value: s.spin.value, min_bill: 0, label: s.spin.label };
    }
    save(s);
    return s.spin;
  },

  async joinLoyalty(key, phone) {
    const s = seatFor(key, false); // works on the receipt too; a closed bill's points count once (see settle)
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) throw new TableError("bad_phone");
    if (s.closed_at && s.phone) return;
    s.phone = digits;
    save(s);
  },
};

function newSeat(table: string): DemoSeat {
  return { key: uid().replace(/-/g, "").slice(0, 32), table, opened_at: iso(), closed_at: null, orders: [], payments: [], calls: [],
           discount: null, spin: null, phone: null, orderNo: 0 };
}

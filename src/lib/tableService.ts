// Everything a guest's phone does at the table, behind one interface:
//   real restaurants -> the database functions in supabase/migrations/20261122000000_v2_table_service.sql
//   the ZenCafe demo  -> demoTable.ts, which plays kitchen, waiter and cashier on the device
import { supabase } from "@/integrations/supabase/client";
import { isZenCafe } from "@/data/mockRestaurants";
import type { Bill, Discount } from "@/lib/bill";
import type { OrderPayload } from "@/lib/orderFlow";
import { demoTable } from "@/lib/demoTable";

export type CallReason = "waiter" | "water" | "bill" | "help" | "clean";
export type PayMode = "upi" | "card" | "cash";
export type SplitKind = "full" | "equal" | "items" | "custom";

export interface SeatOrder {
  id: string; order_number: string; table_number: string; status: string;
  items: OrderPayload | null; created_at: string; updated_at: string;
}
export interface SeatPayment {
  id: string; payer: string; amount: number; tip: number; mode: PayMode; split: SplitKind;
  status: "pending" | "confirmed" | "rejected"; created_at: string;
}
export interface SeatCall {
  id: string; call_type: CallReason; status: "pending" | "acknowledged" | "completed";
  acknowledged_by: string | null; acknowledged_at: string | null; created_at: string;
}
export interface SpinPrize { label: string; kind: "pct" | "flat" | "item" | "none"; value?: number; index?: number }
export interface Loyalty { enabled: boolean; rupees_per_point: number; goal: number; reward: string; phone_linked: boolean; points: number | null }

export interface TableState {
  ok: true;
  status: "open" | "closed";
  table: string;        // where this guest sits
  bill_table: string;   // the table whose bill they share (differs after staff merge tables)
  opened_at: string;
  closed_at: string | null;
  orders: SeatOrder[];
  bill: Bill;
  payments: SeatPayment[];
  calls: SeatCall[];
  served_by: string | null;
  discount: Discount | null;
  spin: SpinPrize | null;
  spin_prizes: SpinPrize[];
  loyalty: Loyalty | null;
  wifi: { ssid: string; password: string } | null;
}

export type JoinError = "unavailable" | "bad_table" | "disabled" | "inactive" | "locked" | "bad_pin";
export type JoinResult = { ok: true; key: string; table: string } | { ok: false; error: JoinError; tries_left?: number };

/** One cart line as the kitchen needs it; the price is looked up on the server */
export interface CartLine { id: string; qty: number; size?: string | null; addons?: string[]; note?: string }
export interface PayRequest { amount: number; tip: number; mode: PayMode; payer: string; split: SplitKind }

export interface TableApi {
  demo: boolean;
  join(table: string, pin?: string): Promise<JoinResult>;
  state(key: string): Promise<TableState | null>;
  placeOrder(key: string, lines: CartLine[], note: string | null, clientId: string): Promise<SeatOrder>;
  cancelOrder(key: string, orderId: string): Promise<void>;
  callStaff(key: string, reason: CallReason): Promise<void>;
  pay(key: string, p: PayRequest): Promise<void>;
  applyCoupon(key: string, code: string): Promise<void>;
  spin(key: string): Promise<SpinPrize>;
  joinLoyalty(key: string, phone: string): Promise<void>;
}

/** A database error code with any detail it carried (e.g. which dish sold out) */
export class TableError extends Error {
  constructor(public code: string, public detail?: string) { super(code); }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new TableError(error.message, (error as { details?: string }).details || undefined);
  return data as T;
}

/** Staff alerts (OneSignal push). Fire and forget: an order never waits on, or fails because of, a notification. */
export function notifyStaff(type: "order" | "call" | "payment" | "feedback", id: string) {
  supabase.functions.invoke("send-order-notification", { body: { type, id } }).catch(() => {});
}

function supabaseTable(restaurantId: string): TableApi {
  return {
    demo: false,
    join: (table, pin) => rpc("join_table", { p_restaurant_id: restaurantId, p_table: table, p_pin: pin || null }),
    async state(key) {
      const s = await rpc<TableState | { ok: false }>("table_state", { p_key: key });
      return s.ok ? (s as TableState) : null;
    },
    async placeOrder(key, lines, note, clientId) {
      const o = await rpc<SeatOrder>("place_order", { p_key: key, p_lines: lines, p_note: note, p_client_id: clientId });
      notifyStaff("order", o.id);
      return o;
    },
    cancelOrder: (key, orderId) => rpc("cancel_pending_order", { p_key: key, p_order_id: orderId }),
    async callStaff(key, reason) {
      const c = await rpc<{ id: string }>("call_staff", { p_key: key, p_reason: reason });
      notifyStaff("call", c.id);
    },
    async pay(key, p) {
      const x = await rpc<{ id: string }>("request_payment", {
        p_key: key, p_amount: p.amount, p_tip: p.tip, p_mode: p.mode, p_payer: p.payer, p_split: p.split,
      });
      notifyStaff("payment", x.id);
    },
    applyCoupon: (key, code) => rpc("apply_coupon", { p_key: key, p_code: code }),
    spin: (key) => rpc("spin_wheel", { p_key: key }),
    joinLoyalty: (key, phone) => rpc("join_loyalty", { p_key: key, p_phone: phone }),
  };
}

export const tableApi = (restaurantId: string): TableApi => (isZenCafe(restaurantId) ? demoTable : supabaseTable(restaurantId));

/** What the guest reads for each error code */
export function errorCopy(e: unknown): string {
  const code = e instanceof TableError ? e.code : "";
  const detail = e instanceof TableError ? e.detail : undefined;
  switch (code) {
    case "seat_closed": return "This table's bill is closed. Scan the QR code again or ask a member of staff.";
    case "orders_off": return "Ordering from the table is paused. Please order with a member of staff.";
    case "item_unavailable": return `${detail || "A dish"} just sold out. Remove it and try again.`;
    case "item_gone": return "A dish in your order is no longer on the menu. Remove it and try again.";
    case "bad_size": case "bad_addon": case "bad_items": return "Something in your order changed. Check it and try again.";
    case "too_many": return "You have a few orders waiting. Give the kitchen a moment.";
    case "not_editable": return "The kitchen has already started on this order.";
    case "too_soon": return "Staff were just called. You can call again in 30 seconds.";
    case "calls_off": return "Calling staff from the table is switched off. Please wave someone over.";
    case "over_due": return "That's more than what's left on the bill.";
    case "bad_tip": case "bad_mode": case "bad_split": return "Check the amount and try again.";
    case "bad_code": return "That code didn't work. Check the spelling.";
    case "min_bill": return `This code needs a bill of at least ₹${detail || ""}.`;
    case "already_paying": return "Codes can't be added once someone has started paying.";
    case "no_spin": case "order_first": return "Spin & Win opens after your first order.";
    case "bad_phone": return "Enter a 10-digit mobile number.";
    case "no_loyalty": return "Rewards aren't running here right now.";
    default: return navigator.onLine ? "Something went wrong. Please try again." : "You're offline. Check your connection and try again.";
  }
}

export function joinErrorCopy(r: Extract<JoinResult, { ok: false }>, table: string, label = "Table"): string {
  switch (r.error) {
    case "inactive": return `${label} ${table} isn't open yet. Ask a member of staff to open it for you.`;
    case "bad_pin": return r.tries_left ? `That PIN didn't match. ${r.tries_left} ${r.tries_left === 1 ? "try" : "tries"} left.` : "That PIN didn't match.";
    case "locked": return "Too many wrong PINs. Ask a member of staff to reset this table.";
    case "disabled": return `This ${label.toLowerCase()}'s QR code is switched off. Please ask a member of staff.`;
    case "bad_table": return `Enter the ${label.toLowerCase()} number from your table stand.`;
    default: return "This menu isn't available right now.";
  }
}

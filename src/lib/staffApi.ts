// Staff-side calls to the v2 table-service functions (signed-in owner device).
// `by` is the person on shift (useOnShift), so every action lands in the activity log under their name.
import { supabase } from "@/integrations/supabase/client";
import type { Bill, Discount } from "@/lib/bill";

export interface DiningTable {
  id: string; table_number: string; section: string; seats: number; pin: string; is_active: boolean;
  activated_at: string | null; activated_by: string | null; needs_cleaning: boolean; pin_locked_until: string | null;
}
export interface FloorPayment {
  id: string; payer: string; amount: number; tip: number; mode: "upi" | "card" | "cash"; split: string;
  status: "pending" | "confirmed" | "rejected"; table_number: string; created_at: string; confirmed_by: string | null;
}
export interface FloorOrder {
  id: string; order_number: string; status: string; table_number: string; created_at: string;
  items: { name: string; price: number; quantity?: number; selectedSize?: string | null; options?: string | null }[] | null;
}
export interface FloorSeating {
  id: string; table_number: string; status: "open" | "merged"; merged_into: string | null; opened_at: string;
  discount: Discount | null; guest_phone: string | null; bill: Bill | null; orders: FloorOrder[]; payments: FloorPayment[];
  loyalty_points: number | null;
}
export interface FloorCall { id: string; table_number: string; call_type: string; status: string; created_at: string; acknowledged_by: string | null }
export interface FloorState { tables: DiningTable[]; seatings: FloorSeating[]; calls: FloorCall[] }
export interface StaffMember { id: string; name: string; role: "waiter" | "kitchen" | "cashier" | "manager"; section: string; active: boolean; created_at: string }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export const staffApi = {
  floor: (r: string) => rpc<FloorState>("floor_state", { p_restaurant_id: r }),
  openTable: (r: string, table: string, by: string | null) => rpc<{ table: string; pin: string }>("staff_open_table", { p_restaurant_id: r, p_table: table, p_by: by }),
  closeTable: (r: string, table: string, by: string | null, note?: string) => rpc<void>("staff_close_table", { p_restaurant_id: r, p_table: table, p_by: by, p_note: note ?? null }),
  markClean: (r: string, table: string, by: string | null) => rpc<void>("staff_mark_clean", { p_restaurant_id: r, p_table: table, p_by: by }),
  transfer: (r: string, from: string, to: string, by: string | null) => rpc<void>("staff_transfer_table", { p_restaurant_id: r, p_from: from, p_to: to, p_by: by }),
  merge: (r: string, from: string, into: string, by: string | null) => rpc<void>("staff_merge_tables", { p_restaurant_id: r, p_from: from, p_into: into, p_by: by }),
  settle: (paymentId: string, accept: boolean, by: string | null) => rpc<Bill>("staff_settle_payment", { p_payment_id: paymentId, p_accept: accept, p_by: by }),
  addPayment: (r: string, table: string, amount: number, mode: string, by: string | null, tip = 0) =>
    rpc<Bill>("staff_add_payment", { p_restaurant_id: r, p_table: table, p_amount: amount, p_mode: mode, p_tip: tip, p_by: by }),
  redeem: (r: string, phone: string, by: string | null) => rpc<number>("staff_redeem_loyalty", { p_restaurant_id: r, p_phone: phone, p_by: by }),
  saveStaff: (r: string, s: { id?: string | null; name: string; role: string; pin?: string | null; section?: string; active?: boolean }) =>
    rpc<string>("save_staff", { p_restaurant_id: r, p_id: s.id ?? null, p_name: s.name, p_role: s.role, p_pin: s.pin || null, p_section: s.section ?? "", p_active: s.active ?? true }),
  unlock: (r: string, pin: string) => rpc<{ id: string; name: string; role: string; section: string } | null>("staff_unlock", { p_restaurant_id: r, p_pin: pin }),
  /** For actions written straight to a table (order status, calls) so they show in the log too */
  log: (r: string, by: string | null, action: string, details: Record<string, unknown> = {}) =>
    (supabase.from("activity_log" as never) as any).insert({ restaurant_id: r, staff_name: by, action, details }).then(() => {}), // eslint-disable-line @typescript-eslint/no-explicit-any
};

export function staffErrorCopy(e: unknown): string {
  const code = (e as Error)?.message || "";
  const copy: Record<string, string> = {
    money_due: "There's still money due. Take the payment first, or close with a reason.",
    table_busy: "That table already has guests. Merge instead, or pick a free table.",
    no_seating: "That table has no open bill.",
    already_paying: "Someone at that table has already started paying. Settle it before merging.",
    already_settled: "That payment was already handled on another screen.",
    over_due: "That's more than what's left on the bill.",
    bad_pin: "PINs are 4 digits for tables and 4-6 digits for staff.",
    pin_taken: "Another staff member already uses that PIN.",
    bad_table: "Pick a different table.",
    not_enough_points: "Not enough points for the reward yet.",
    "Not your restaurant": "You're signed in to a different restaurant.",
  };
  if (copy[code]) return copy[code];
  if (/function .* does not exist|schema cache/i.test(code)) return "The database hasn't been updated for table service yet (run the v2 migration).";
  return code || "Something went wrong. Please try again.";
}

export const PAY_MODE: Record<string, string> = { upi: "UPI", card: "Card", cash: "Cash" };
export const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: Math.round(n * 100) % 100 ? 2 : 0, minimumFractionDigits: Math.round(n * 100) % 100 ? 2 : 0 }).format(Number(n || 0));
export const since = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return "";
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

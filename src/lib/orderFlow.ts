// One source of truth for the order lifecycle, shared by the customer menu, the Kitchen Display and the dashboard.
// pending (NEW) → accepted → preparing → ready → completed (SERVED); rejected / cancelled end it early.

export type OrderStatus = "pending" | "accepted" | "preparing" | "ready" | "completed" | "rejected" | "cancelled";

export interface OrderLine {
  id?: string;
  name: string;
  price: number;
  quantity?: number;
  image_url?: string | null;
  selectedSize?: string | null;
  /** Customer's customisation, e.g. "Medium spice · no onion" */
  options?: string | null;
}

/** Stored in orders.items (jsonb) so no schema change is needed for notes or step times */
export interface OrderPayload {
  items?: OrderLine[];
  note?: string | null;
  timeline?: Partial<Record<OrderStatus, string>>;
}

export const FLOW: OrderStatus[] = ["pending", "accepted", "preparing", "ready", "completed"];

export const STATUS: Record<OrderStatus, { badge: string; step: string; dot: string; badgeClass: string }> = {
  pending: { badge: "New", step: "Order received", dot: "bg-amber-500", badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  accepted: { badge: "Accepted", step: "Kitchen accepted", dot: "bg-sky-500", badgeClass: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  preparing: { badge: "Preparing", step: "Preparing", dot: "bg-[#C0602F]", badgeClass: "bg-[#C0602F]/15 text-[#B0522C] dark:text-[#E08A5C]" },
  ready: { badge: "Ready", step: "Ready", dot: "bg-emerald-500", badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  completed: { badge: "Served", step: "Served", dot: "bg-stone-400", badgeClass: "bg-stone-500/15 text-stone-600 dark:text-stone-300" },
  rejected: { badge: "Rejected", step: "Not accepted", dot: "bg-red-500", badgeClass: "bg-red-500/15 text-red-600 dark:text-red-400" },
  cancelled: { badge: "Cancelled", step: "Cancelled", dot: "bg-red-500", badgeClass: "bg-red-500/15 text-red-600 dark:text-red-400" },
};

export const ACTIVE: OrderStatus[] = ["pending", "accepted", "preparing", "ready"];
export const isActive = (s: string) => (ACTIVE as string[]).includes(s);
export const asStatus = (s: string): OrderStatus => (s in STATUS ? (s as OrderStatus) : "pending");

/** "ORD004730" → "4730": short enough to call out across a kitchen */
export const shortOrderNo = (n: string) => n.replace(/^ORD0*/, "") || n;

export const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));

// ponytail: flat prep estimate; per-dish prep times would make this accurate
const PREP_MINUTES = 15;
export function etaMinutes(order: { status: string; created_at: string }, now = Date.now()): number | null {
  if (!["pending", "accepted", "preparing"].includes(order.status)) return null;
  return Math.max(2, PREP_MINUTES - minutesSince(order.created_at, now));
}

/** Update payload that also stamps when this step happened, so the tracker can show step times */
export function withStatus(order: { items: unknown }, status: OrderStatus) {
  const payload = (order.items || {}) as OrderPayload;
  return { status, items: { ...payload, timeline: { ...payload.timeline, [status]: new Date().toISOString() } } };
}

export const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");

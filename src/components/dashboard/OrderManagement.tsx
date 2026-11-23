// Orders, made for a phone. "Now" lists every open order with one big button each (Accept, then Mark served).
// "Done" holds finished and cancelled orders with a search. Sales totals live in Reports, not here.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useBusinessType } from "@/hooks/useBusinessType";
import { Bell, ChevronDown, Package, Search } from "lucide-react";
import { STATUS, STATUS_TONE, asStatus, isActive, shortOrderNo, type OrderPayload } from "@/lib/orderFlow";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";

interface Order {
  id: string;
  order_number: string;
  table_number: string;
  items: OrderPayload | null;
  status: string;
  created_at: string;
  session_id: string | null;
}

interface OrderManagementProps {
  restaurantId: string;
  onNewOrder?: (order: Order) => void;
  newOrderTrigger?: Order | null;
  isVisible?: boolean;
}

interface Group { id: string; table: string; orders: Order[]; total: number; latest: string; hasNew: boolean; waiting: boolean }

type Range = "today" | "week" | "month" | "all";
const RANGE: Record<Range, string> = { today: "Today", week: "Last 7 days", month: "This month", all: "All time" };

const STOPPED = ["rejected", "cancelled"];
const orderTotal = (o: Order) => (o.items?.items || []).reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
const ago = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

/** One card per table visit (orders sharing a session), tables with a new order first */
function groupOrders(list: Order[], newIds: Set<string>): Group[] {
  const map = new Map<string, Group>();
  for (const o of list) {
    const id = o.session_id || `one_${o.id}`;
    const g = map.get(id) ?? { id, table: o.table_number, orders: [], total: 0, latest: o.created_at, hasNew: false, waiting: false };
    g.orders.push(o);
    if (!STOPPED.includes(o.status)) g.total += orderTotal(o);
    if (new Date(o.created_at) > new Date(g.latest)) g.latest = o.created_at;
    if (newIds.has(o.id)) g.hasNew = true;
    if (o.status === "pending") g.waiting = true;
    map.set(id, g);
  }
  return [...map.values()].sort((a, b) => Number(b.waiting) - Number(a.waiting) || new Date(b.latest).getTime() - new Date(a.latest).getTime());
}

const OrderManagement = ({ restaurantId, newOrderTrigger, isVisible }: OrderManagementProps) => {
  const { toast } = useToast();
  const { locationLabel } = useBusinessType(restaurantId);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"now" | "done">("now");
  const [range, setRange] = useState<Range>("today");
  const [query, setQuery] = useState("");
  const [openRows, setOpenRows] = useState<Set<string>>(new Set()); // expanded cards on the Done list
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchOrders = async () => {
    const { data, error } = await supabase.from("orders").select("*").eq("restaurant_id", restaurantId).order("created_at", { ascending: false });
    if (error) toast({ title: "Couldn't load orders", description: "Check your internet and try again.", variant: "destructive" });
    else setOrders((data || []) as unknown as Order[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();
    // New orders arrive through newOrderTrigger (the dashboard listens for inserts); this keeps statuses in sync
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = supabase
      .channel(`order-management-updates-${restaurantId}-${Date.now()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => { const next = payload.new as Order; setOrders(prev => prev.map(o => (o.id === next.id ? next : o))); })
      .subscribe();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [restaurantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (isVisible) fetchOrders(); }, [isVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const o = newOrderTrigger;
    if (!o?.id) return;
    setOrders(prev => (prev.some(x => x.id === o.id) ? prev : [o, ...prev]));
    setNewIds(prev => new Set(prev).add(o.id));
    setView("now");
    const t = setTimeout(() => setNewIds(prev => { const n = new Set(prev); n.delete(o.id); return n; }), 10000);
    return () => clearTimeout(t);
  }, [newOrderTrigger]);

  const setStatus = async (id: string, status: string) => {
    setOrders(prev => prev.map(o => (o.id === id ? { ...o, status } : o)));
    const { error } = await supabase.from("orders").update({ status }).eq("id", id);
    if (error) {
      fetchOrders();
      toast({ title: "Couldn't update the order", description: "Check your internet and try again.", variant: "destructive" });
    } else {
      toast({ title: status === "preparing" ? "Accepted. The kitchen can start." : status === "completed" ? "Served" : "Rejected", duration: 1500 });
    }
  };

  const live = useMemo(() => orders.filter(o => isActive(o.status)), [orders]);
  const done = useMemo(() => {
    const now = new Date();
    const from = range === "today" ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : range === "week" ? new Date(Date.now() - 7 * 864e5)
      : range === "month" ? new Date(now.getFullYear(), now.getMonth(), 1) : null;
    const q = query.trim().toLowerCase();
    return orders.filter(o => !isActive(o.status)
      && (!from || new Date(o.created_at) >= from)
      && (!q || o.order_number.toLowerCase().includes(q) || o.table_number.toLowerCase().includes(q)
        || (o.items?.items || []).some(i => i.name.toLowerCase().includes(q))));
  }, [orders, range, query]);
  const groups = useMemo(() => groupOrders(view === "now" ? live : done, newIds), [view, live, done, newIds]);
  const fresh = live.filter(o => o.status === "pending").length;
  const toggleRow = (id: string) => setOpenRows(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40 rounded-xl" />
        <Skeleton className="h-12 w-full max-w-xs rounded-full" />
        {[1, 2].map(i => <Skeleton key={i} className="h-44 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Orders</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {live.length === 0 ? "No open orders right now" : [fresh && `${fresh} new`, live.length - fresh && `${live.length - fresh} in the kitchen`].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div role="tablist" aria-label="Orders" className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1 max-w-xs">
        {(["now", "done"] as const).map(v => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={cn("h-10 rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
            {v === "now" ? `Now${live.length ? ` · ${live.length}` : ""}` : "Done"}
          </button>
        ))}
      </div>

      {view === "done" && (
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input type="search" aria-label="Search orders" placeholder={`Order #, ${locationLabel.toLowerCase()} or dish`}
              value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9 h-11" />
          </div>
          <select aria-label="Show orders from" value={range} onChange={(e) => setRange(e.target.value as Range)}
            className="h-11 rounded-md border border-input bg-background px-3 text-sm">
            {(Object.keys(RANGE) as Range[]).map(r => <option key={r} value={r}>{RANGE[r]}</option>)}
          </select>
        </div>
      )}

      <div className="space-y-3">
        {groups.map(g => view === "now" ? (
          <section key={g.id} aria-label={`${locationLabel} ${g.table}`}
            className={cn("rounded-2xl border bg-card", g.hasNew ? "border-primary/50 ring-1 ring-primary/25" : "border-border")}>
            <header className="flex items-baseline justify-between gap-3 px-4 pt-4">
              <h3 className="font-display text-2xl leading-none">{locationLabel} {g.table}</h3>
              <span className="text-sm text-muted-foreground tabular-nums">₹{g.total.toFixed(0)}</span>
            </header>
            <ul className="divide-y divide-border">
              {g.orders.map(o => <LiveOrder key={o.id} order={o} isNew={newIds.has(o.id)} onStatus={setStatus} />)}
            </ul>
          </section>
        ) : (
          <section key={g.id} className="rounded-2xl border border-border bg-card">
            <button type="button" aria-expanded={openRows.has(g.id)} onClick={() => toggleRow(g.id)}
              className="w-full flex items-center justify-between gap-3 p-4 text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0">
                <span className="font-display text-xl leading-none">{locationLabel} {g.table}</span>
                <span className="block mt-1 text-xs text-muted-foreground">
                  {range === "today" ? clock(g.latest) : ago(g.latest)} · {g.orders.length} {g.orders.length === 1 ? "order" : "orders"}
                </span>
              </span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="font-semibold tabular-nums">₹{g.total.toFixed(0)}</span>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", openRows.has(g.id) && "rotate-180")} />
              </span>
            </button>
            {openRows.has(g.id) && (
              <ul className="border-t border-border divide-y divide-border">
                {g.orders.map(o => (
                  <li key={o.id} className="p-4 space-y-2">
                    <OrderHead order={o} />
                    <Lines order={o} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {groups.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Package className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 font-medium">{view === "now" ? "No open orders" : "Nothing here"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {view === "now" ? "New orders appear here with a sound." : query ? "Try another search." : "Finished orders appear here."}
          </p>
        </div>
      )}
    </div>
  );
};

/** "#4730 · New · 2 min ago" */
const OrderHead = ({ order, isNew }: { order: Order; isNew?: boolean }) => {
  const s = asStatus(order.status);
  return (
    <div className="flex items-center gap-2 text-sm">
      {isNew && <Bell className="h-4 w-4 text-primary" aria-label="New" />}
      <span className="font-semibold tabular-nums">#{shortOrderNo(order.order_number)}</span>
      <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_TONE[s])}>{STATUS[s].badge}</span>
      <span className="ml-auto text-xs text-muted-foreground">{ago(order.created_at)}</span>
    </div>
  );
};

/** What to make: "2 × Latte · Large", the guest's options under it, and the order note */
const Lines = ({ order }: { order: Order }) => (
  <div className="space-y-1">
    <ul className="space-y-1 text-[15px]">
      {(order.items?.items || []).map((i, k) => (
        <li key={k}>
          <span className="font-semibold tabular-nums">{i.quantity || 1} ×</span> {i.name}
          {i.selectedSize && <span className="text-muted-foreground"> · {i.selectedSize}</span>}
          {i.options && <span className="block pl-6 text-sm text-muted-foreground">{i.options}</span>}
        </li>
      ))}
    </ul>
    {order.items?.note && <p className="rounded-lg bg-muted px-3 py-2 text-sm">Note: {order.items.note}</p>}
  </div>
);

/** An open order: what to make and the one next step. New → Accept (straight to cooking). Anything after → Mark served. */
function LiveOrder({ order, isNew, onStatus }: { order: Order; isNew: boolean; onStatus: (id: string, status: string) => void }) {
  const s = asStatus(order.status);
  return (
    <li className={cn("p-4 space-y-3", isNew && "bg-accent/40")}>
      <OrderHead order={order} isNew={isNew} />
      <Lines order={order} />
      {s === "pending" ? (
        <Button className="w-full h-12 text-base" onClick={() => onStatus(order.id, "preparing")}>Accept</Button>
      ) : (
        <Button variant="outline" className="w-full h-12 text-base" onClick={() => onStatus(order.id, "completed")}>Mark served</Button>
      )}
      {(s === "pending" || s === "accepted") && (
        <button type="button" onClick={() => onStatus(order.id, "rejected")}
          className="-ml-2 -my-1 h-10 px-2 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10">Reject</button>
      )}
    </li>
  );
}

export default OrderManagement;

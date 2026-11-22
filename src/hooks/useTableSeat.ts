// The guest's place at the table: the seating key (kept on this phone), the live table state and every table action.
// Polls while the page is visible (realtime nudges it sooner when one of this table's orders changes), and queues
// orders placed offline: each keeps its client id, so a retry can never order twice.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  tableApi, type CallReason, type CartLine, type JoinResult, type PayRequest, type SeatOrder, type TableState,
} from "@/lib/tableService";

interface Seat { key: string; table: string }
interface QueuedOrder { table: string; lines: CartLine[]; note: string | null; clientId: string }

const read = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const write = (k: string, v: unknown) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const offline = (e: unknown) => !navigator.onLine || e instanceof TypeError || /fetch|network|timed out/i.test(String((e as Error)?.message));

export function useTableSeat(restaurantId: string | undefined, onQueueFailed?: (e: unknown) => void) {
  const api = useMemo(() => (restaurantId ? tableApi(restaurantId) : null), [restaurantId]);
  const seatKey = `qm_seat_${restaurantId}`;
  const queueKey = `qm_queue_${restaurantId}`;
  const [seat, setSeatState] = useState<Seat | null>(() => read<Seat>(seatKey));
  const [state, setState] = useState<TableState | null>(null);
  const [checked, setChecked] = useState(false); // first answer is in, so the PIN screen never flashes for a seated guest
  const [queued, setQueued] = useState(() => read<QueuedOrder[]>(queueKey)?.length || 0);
  const seatRef = useRef(seat);
  seatRef.current = seat;
  const stateRef = useRef(state);
  stateRef.current = state;
  const orderIds = useRef<Set<string>>(new Set());
  const failRef = useRef(onQueueFailed);
  failRef.current = onQueueFailed;

  const setSeat = useCallback((s: Seat | null) => { setSeatState(s); seatRef.current = s; write(seatKey, s); }, [seatKey]);

  const refresh = useCallback(async () => {
    const s = seatRef.current;
    if (!api || !s) { setChecked(true); return null; }
    try {
      const st = await api.state(s.key);
      if (seatRef.current?.key !== s.key) return null; // the guest switched tables meanwhile
      if (!st) { setSeat(null); setState(null); } else { setState(st); orderIds.current = new Set(st.orders.map(o => o.id)); }
      return st;
    } catch {
      return null; // offline: keep showing what we had
    } finally {
      setChecked(true);
    }
  }, [api, setSeat]);

  useEffect(() => {
    if (!seat) { setState(null); setChecked(true); return; }
    refresh();
    const t = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, api?.demo ? 1500 : 5000);
    const onShow = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [seat?.key, refresh, api?.demo]);

  useEffect(() => {
    if (!api || api.demo || !seat || !restaurantId) return;
    const ch = supabase.channel(`seat-${seat.key.slice(0, 8)}-${Date.now()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        (p: { new: { id: string } }) => { if (orderIds.current.has(p.new.id)) refresh(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [api, seat?.key, restaurantId, refresh]);

  const join = useCallback(async (table: string, pin?: string): Promise<JoinResult> => {
    if (!api) return { ok: false, error: "unavailable" };
    const r = await api.join(table.trim(), pin);
    if (r.ok) { setChecked(false); setSeat({ key: r.key, table: r.table }); }
    return r;
  }, [api, setSeat]);

  /** The key for this table, joining it first when needed (no-PIN restaurants). Throws the JoinResult on failure. */
  const keyFor = useCallback(async (table: string) => {
    const s = seatRef.current;
    // A paid, closed bill can't take new orders: a no-PIN table starts a fresh bill (PIN tables go back to the PIN screen)
    if (s && s.table === table.trim() && stateRef.current?.status !== "closed") return s.key;
    const r = await join(table);
    if (!r.ok) throw r;
    return r.key;
  }, [join]);

  const act = useCallback(async <T,>(fn: (key: string) => Promise<T>) => {
    const s = seatRef.current;
    if (!api || !s) throw new Error("No table");
    const out = await fn(s.key);
    await refresh();
    return out;
  }, [api, refresh]);

  const placeOrder = useCallback(async (table: string, lines: CartLine[], note: string | null):
    Promise<{ order: SeatOrder | null; queued: boolean }> => {
    if (!api) throw new Error("No restaurant");
    const clientId = crypto.randomUUID();
    try {
      const key = await keyFor(table);
      const order = await api.placeOrder(key, lines, note, clientId);
      await refresh();
      return { order, queued: false };
    } catch (e) {
      if (!offline(e)) throw e;
      const q = [...(read<QueuedOrder[]>(queueKey) || []), { table, lines, note, clientId }];
      write(queueKey, q);
      setQueued(q.length);
      return { order: null, queued: true };
    }
  }, [api, keyFor, refresh, queueKey]);

  // Send queued orders once the phone is back online (same client ids, so nothing doubles)
  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (!api || flushing.current || !navigator.onLine) return;
    flushing.current = true;
    try {
      let q = read<QueuedOrder[]>(queueKey) || [];
      while (q.length) {
        const [next] = q;
        try {
          await api.placeOrder(await keyFor(next.table), next.lines, next.note, next.clientId);
        } catch (e) {
          if (offline(e)) break;
          failRef.current?.(e); // refused for a real reason (sold out, table closed): drop it and tell the guest
        }
        q = q.slice(1);
        write(queueKey, q.length ? q : null);
        setQueued(q.length);
      }
      if (seatRef.current) await refresh();
    } finally {
      flushing.current = false;
    }
  }, [api, keyFor, queueKey, refresh]);

  useEffect(() => {
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [flush]);

  return {
    api,
    seat,
    state,
    checked,
    queued,
    join,
    refresh,
    leave: () => { setSeat(null); setState(null); },
    placeOrder,
    cancelOrder: (orderId: string) => act(k => api!.cancelOrder(k, orderId)),
    callStaff: async (table: string, reason: CallReason) => { await keyFor(table); return act(k => api!.callStaff(k, reason)); },
    pay: (p: PayRequest) => act(k => api!.pay(k, p)),
    applyCoupon: (code: string) => act(k => api!.applyCoupon(k, code)),
    spin: () => act(k => api!.spin(k)),
    joinLoyalty: (phone: string) => act(k => api!.joinLoyalty(k, phone)),
  };
}

export type TableSeat = ReturnType<typeof useTableSeat>;

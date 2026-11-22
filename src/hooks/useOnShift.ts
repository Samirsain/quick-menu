// Who is working this device right now. Restaurants share one signed-in tablet or phone; staff pick themselves with
// their PIN so the activity log and the guest's "Rahul is on the way" show a real name.
import { useCallback, useEffect, useState } from "react";
import { staffApi } from "@/lib/staffApi";

export interface OnShift { id: string; name: string; role: string; section?: string }
const key = (r: string | null) => `qm_shift_${r}`;
const EVENT = "qm-shift";

function read(r: string | null): OnShift | null {
  try { return JSON.parse(localStorage.getItem(key(r)) || "null"); } catch { return null; }
}

export function useOnShift(restaurantId: string | null) {
  const [who, setWho] = useState<OnShift | null>(() => read(restaurantId));

  useEffect(() => {
    setWho(read(restaurantId));
    const sync = () => setWho(read(restaurantId));
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, [restaurantId]);

  const set = useCallback((v: OnShift | null) => {
    try { if (v) localStorage.setItem(key(restaurantId), JSON.stringify(v)); else localStorage.removeItem(key(restaurantId)); } catch { /* private mode */ }
    window.dispatchEvent(new Event(EVENT));
  }, [restaurantId]);

  /** true when the PIN matched someone */
  const unlock = useCallback(async (pin: string) => {
    if (!restaurantId) return false;
    const m = await staffApi.unlock(restaurantId, pin);
    if (!m) return false;
    set(m);
    return true;
  }, [restaurantId, set]);

  return { who, name: who?.name ?? null, unlock, signOut: () => set(null) };
}

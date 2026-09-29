import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, User, Droplets, Receipt, X, Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { isRateLimited, getClientFingerprint } from "@/lib/security";

interface ServiceCallButtonProps {
  restaurantId: string;
  tableNumber?: string;
  disabled?: boolean;
  /** Tailwind bottom-* class so the button can sit above bottom bars */
  positionClassName?: string;
  /** Render as a small header icon instead of a floating button */
  inline?: boolean;
  /** Classes for the inline trigger, to match the surrounding header */
  triggerClassName?: string;
}

const SERVICE_OPTIONS = [
  { type: "waiter", label: "Call a waiter", hint: "Someone will come to your table", icon: User },
  { type: "water", label: "Water", hint: "A fresh jug for the table", icon: Droplets },
  { type: "bill", label: "The bill", hint: "We'll bring it over", icon: Receipt },
] as const;

type CallType = typeof SERVICE_OPTIONS[number]["type"];

const ServiceCallButton = ({ restaurantId, tableNumber: propTableNumber, disabled, positionClassName = "bottom-6", inline = false, triggerClassName }: ServiceCallButtonProps) => {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState<CallType | null>(null);
  const [recentCalls, setRecentCalls] = useState<Record<CallType, boolean>>({
    waiter: false,
    water: false,
    bill: false,
  });
  const [, setPendingCalls] = useState<any[]>([]);
  const channelRef = useRef<any>(null);
  const autoCloseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [localTableNumber, setLocalTableNumber] = useState(() => 
    localStorage.getItem(`service_table_${restaurantId}`) || ""
  );
  
  // Use prop table number if provided, otherwise use local state
  const tableNumber = propTableNumber || localTableNumber;
  
  // Save table number to localStorage when changed
  const handleTableNumberChange = (value: string) => {
    setLocalTableNumber(value);
    if (value) {
      localStorage.setItem(`service_table_${restaurantId}`, value);
    }
  };

  // Auto-close realtime connection after 2 minutes of inactivity
  const resetAutoCloseTimer = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
    }
    autoCloseTimerRef.current = setTimeout(() => {
      // Close the modal and disconnect realtime after 2 minutes
      setIsOpen(false);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    }, 2 * 60 * 1000); // 2 minutes
  };

  // Cleanup auto-close timer on unmount
  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, []);

  // Subscribe to realtime updates only when modal is open
  useEffect(() => {
    if (!isOpen || !restaurantId || !tableNumber) return;

    // Start auto-close timer when modal opens
    resetAutoCloseTimer();

    // Fetch existing pending calls for this table
    const fetchPendingCalls = async () => {
      const { data } = await supabase
        .from("service_calls")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("table_number", tableNumber)
        .in("status", ["pending", "acknowledged"])
        .order("created_at", { ascending: false });
      
      if (data) {
        setPendingCalls(data);
        // Mark recent calls
        const recent: Record<CallType, boolean> = { waiter: false, water: false, bill: false };
        data.forEach(call => {
          if (call.status === "pending" || call.status === "acknowledged") {
            recent[call.call_type as CallType] = true;
          }
        });
        setRecentCalls(recent);
      }
    };

    fetchPendingCalls();

    // Subscribe to updates
    const channelName = `service-calls-${restaurantId}-${tableNumber}-${Date.now()}`;
    channelRef.current = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_calls",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newCall = payload.new as any;
            if (newCall.table_number === tableNumber) {
              setPendingCalls(prev => [newCall, ...prev]);
              setRecentCalls(prev => ({ ...prev, [newCall.call_type]: true }));
            }
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as any;
            if (updated.table_number === tableNumber) {
              setPendingCalls(prev => 
                prev.map(c => c.id === updated.id ? updated : c)
                  .filter(c => c.status !== "completed")
              );
              if (updated.status === "completed") {
                setRecentCalls(prev => ({ ...prev, [updated.call_type]: false }));
                toast({
                  title: "Request completed",
                  description: `Your ${updated.call_type} request has been handled`,
                  duration: 3000,
                });
              } else if (updated.status === "acknowledged") {
                toast({
                  title: "Staff are on their way",
                  description: `Staff is on the way for your ${updated.call_type} request`,
                  duration: 3000,
                });
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, [isOpen, restaurantId, tableNumber, toast]);

  const handleServiceCall = async (callType: CallType) => {
    if (!tableNumber) {
      toast({
        title: "Table number required",
        description: "Please enter your table number first",
        variant: "destructive",
      });
      return;
    }

    // Reset auto-close timer on user activity
    resetAutoCloseTimer();

    // Rate limit: 3 calls per minute per type
    const rateLimitKey = `service_call_${callType}_${getClientFingerprint()}`;
    if (isRateLimited(rateLimitKey, { maxRequests: 3, windowMs: 60000 })) {
      toast({
        title: "Please wait",
        description: "You've made too many requests. Try again in a minute.",
        variant: "destructive",
      });
      return;
    }

    // Check if there's already a pending call of this type
    if (recentCalls[callType]) {
      toast({
        title: "Request already sent",
        description: `Your ${callType} request is being processed`,
        variant: "default",
      });
      return;
    }

    setLoading(callType);

    try {
      const { error } = await supabase
        .from("service_calls")
        .insert({
          restaurant_id: restaurantId,
          table_number: tableNumber,
          call_type: callType,
          status: "pending",
        });

      if (error) throw error;

      setRecentCalls(prev => ({ ...prev, [callType]: true }));
      
      toast({
        title: "Request sent",
        description: `${callType.charAt(0).toUpperCase() + callType.slice(1)} request sent to staff`,
        duration: 3000,
      });

      // Vibrate on mobile
      if ("vibrate" in navigator) {
        navigator.vibrate(100);
      }
    } catch (err: any) {
      toast({
        title: "Failed to send request",
        description: err.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setLoading(null);
    }
  };

  if (disabled) return null;

  return (
    <>
      {inline ? (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Call waiter, water or bill"
          className={triggerClassName ?? "relative h-9 w-9 rounded-full flex items-center justify-center text-menu-ink/80 hover:bg-menu-ink/5 transition-colors"}
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
          {Object.values(recentCalls).some(v => v) && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full ring-2 ring-white/80" />}
        </button>
      ) : (
      // Floating bell - sits above whatever bottom bar is showing
      <motion.button
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.6 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => setIsOpen(true)}
        aria-label="Call waiter, water or bill"
        className={`fixed right-4 ${positionClassName} z-50 h-12 w-12 rounded-full bg-menu-card text-menu-ink border border-menu-line shadow-[0_12px_30px_-12px_rgba(28,25,23,0.45)] flex items-center justify-center transition-[bottom] duration-500 ease-out`}
      >
        <Bell className="w-[18px] h-[18px]" strokeWidth={1.75} />
        {Object.values(recentCalls).some(v => v) && (
          <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-emerald-500 rounded-full ring-2 ring-menu-card" />
        )}
      </motion.button>
      )}

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.45, ease: EASE }}
              className="fixed bottom-0 left-0 right-0 z-50 p-3 sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-sm sm:w-full"
            >
              <div role="dialog" aria-modal="true" aria-labelledby="service-title" className="rounded-3xl overflow-hidden border border-menu-line bg-menu-bg text-menu-ink shadow-[0_30px_80px_-20px_rgba(28,25,23,0.35)]">
                <div className="px-6 pt-6 pb-2 flex items-start justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-menu-muted">{tableNumber ? `Table ${tableNumber}` : "Your table"}</p>
                    <h3 id="service-title" className="mt-2 font-display text-[28px] leading-tight tracking-tight">How can we help?</h3>
                  </div>
                  <button onClick={() => setIsOpen(false)} aria-label="Close" className="h-9 w-9 -mr-2 rounded-full flex items-center justify-center text-menu-muted hover:text-menu-ink hover:bg-menu-ink/5 transition-colors">
                    <X className="w-[18px] h-[18px]" strokeWidth={1.75} />
                  </button>
                </div>

                {!propTableNumber && (
                  <div className="px-6 pt-3">
                    <input
                      type="text"
                      placeholder="Table number"
                      value={localTableNumber}
                      onChange={(e) => handleTableNumberChange(e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-menu-line bg-menu-card text-[15px] outline-none focus:border-menu-accent/60 transition-colors"
                      maxLength={10}
                    />
                  </div>
                )}

                <div className="px-6 pt-3 pb-2 divide-y divide-menu-line">
                  {SERVICE_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const isPending = recentCalls[option.type];
                    const isLoading = loading === option.type;
                    return (
                      <button
                        key={option.type}
                        onClick={() => handleServiceCall(option.type)}
                        disabled={isLoading || isPending}
                        className="w-full py-4 flex items-center gap-4 text-left group disabled:cursor-default"
                      >
                        <span className={`h-10 w-10 rounded-full flex items-center justify-center border transition-colors ${isPending ? "border-emerald-600 bg-emerald-600 text-white" : "border-transparent bg-menu-tint text-menu-accent group-hover:bg-menu-accent group-hover:text-white"}`}>
                          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isPending ? <Check className="w-4 h-4" strokeWidth={2.25} /> : <Icon className="w-4 h-4" strokeWidth={1.75} />}
                        </span>
                        <span className="flex-1">
                          <span className="block text-[15px] font-medium">{option.label}</span>
                          <span className="block text-[13px] text-menu-muted">{isPending ? "On the way" : option.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="px-6 pb-6 text-xs text-menu-muted">Staff are notified instantly.</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

const EASE = [0.22, 1, 0.36, 1] as const;

export default ServiceCallButton;

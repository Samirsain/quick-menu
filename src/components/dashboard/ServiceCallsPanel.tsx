import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useBusinessType } from "@/hooks/useBusinessType";
import { Bell, User, Droplets, Receipt, Check, Clock, LifeBuoy, SprayCan, Footprints } from "lucide-react";
import { useOnShift } from "@/hooks/useOnShift";
import { staffApi } from "@/lib/staffApi";
import { motion, AnimatePresence } from "framer-motion";

interface ServiceCall {
  id: string;
  restaurant_id: string;
  table_number: string;
  call_type: "waiter" | "water" | "bill" | "help" | "clean";
  status: "pending" | "acknowledged" | "completed";
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by?: string | null;
  completed_at: string | null;
}

interface ServiceCallsPanelProps {
  restaurantId: string;
  onNewCall?: (call: ServiceCall) => void;
}

const CALL_CONFIG = {
  waiter: { icon: User, label: "Waiter" },
  water: { icon: Droplets, label: "Water" },
  bill: { icon: Receipt, label: "Bill" },
  help: { icon: LifeBuoy, label: "Help" },
  clean: { icon: SprayCan, label: "Clean the table" },
};
// Unanswered this long and the card turns red for whoever is managing the floor
const ESCALATE_MS = 3 * 60 * 1000;

const ServiceCallsPanel = ({ restaurantId, onNewCall }: ServiceCallsPanelProps) => {
  const { toast } = useToast();
  const { locationLabel } = useBusinessType(restaurantId);
  const { name: onShift } = useOnShift(restaurantId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const [calls, setCalls] = useState<ServiceCall[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const processedCallIds = useRef<Set<string>>(new Set());
  const initialLoadDone = useRef(false);

  useEffect(() => {
    fetchCalls();
    subscribeToServiceCalls();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [restaurantId]);

  const fetchCalls = async () => {
    try {
      const { data, error } = await supabase
        .from("service_calls")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .in("status", ["pending", "acknowledged"])
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      
      setCalls((data || []) as ServiceCall[]);
      // Mark existing calls as processed to avoid sound on initial load
      ((data || []) as ServiceCall[]).forEach(call => processedCallIds.current.add(call.id));
      initialLoadDone.current = true;
    } catch (error) {
      console.error("Error fetching service calls:", error);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToServiceCalls = () => {
    const channelName = `service-calls-dashboard-${restaurantId}-${Date.now()}`;
    
    channelRef.current = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "service_calls",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const newCall = payload.new as ServiceCall;
          
          // Skip if already processed
          if (processedCallIds.current.has(newCall.id)) return;
          processedCallIds.current.add(newCall.id);
          
          setCalls(prev => [newCall, ...prev]);
          
          // Only play sound and show notification after initial load
          if (initialLoadDone.current) {
            playNotificationSound();
            onNewCall?.(newCall);
            
            toast({
              title: `${CALL_CONFIG[newCall.call_type].label} request`,
              description: `${locationLabel} ${newCall.table_number} needs ${newCall.call_type}`,
              duration: 10000,
            });

            // Vibrate on mobile
            if ("vibrate" in navigator) {
              navigator.vibrate([200, 100, 200]);
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "service_calls",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const updated = payload.new as ServiceCall;
          setCalls(prev => {
            if (updated.status === "completed") {
              return prev.filter(c => c.id !== updated.id);
            }
            return prev.map(c => c.id === updated.id ? updated : c);
          });
        }
      )
      .subscribe();
  };

  // Bell ringing sound notification (plays for 6+ seconds)
  const playNotificationSound = () => {
    // Clear any existing sound interval
    if (soundIntervalRef.current) {
      clearInterval(soundIntervalRef.current);
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const ctx = audioContextRef.current;
    if (ctx.state === "suspended") ctx.resume();

    let ringCount = 0;
    const maxRings = 8; // 8 rings over ~6-7 seconds

    const playBellRing = () => {
      if (ringCount >= maxRings) {
        if (soundIntervalRef.current) {
          clearInterval(soundIntervalRef.current);
          soundIntervalRef.current = null;
        }
        return;
      }

      const now = ctx.currentTime;
      
      // Create a realistic bell sound with multiple harmonics
      const bellFrequencies = [
        { freq: 830, gain: 0.4 },   // Main bell tone (high)
        { freq: 1245, gain: 0.25 }, // First harmonic
        { freq: 1660, gain: 0.15 }, // Second harmonic
        { freq: 415, gain: 0.2 },   // Lower undertone
      ];

      bellFrequencies.forEach(({ freq, gain: gainValue }) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.frequency.value = freq;
        osc.type = "sine";
        
        // Bell-like envelope: quick attack, long decay
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(gainValue, now + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(gainValue * 0.3, now + 0.15);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        
        osc.start(now);
        osc.stop(now + 0.6);
      });

      // Add a second strike for "ding-dong" effect
      setTimeout(() => {
        const now2 = ctx.currentTime;
        const secondBellFreqs = [
          { freq: 622, gain: 0.35 },  // Lower tone for "dong"
          { freq: 933, gain: 0.2 },
          { freq: 1244, gain: 0.1 },
        ];

        secondBellFreqs.forEach(({ freq, gain: gainValue }) => {
          const osc = ctx.createOscillator();
          const gainNode = ctx.createGain();
          
          osc.connect(gainNode);
          gainNode.connect(ctx.destination);
          
          osc.frequency.value = freq;
          osc.type = "sine";
          
          gainNode.gain.setValueAtTime(0, now2);
          gainNode.gain.linearRampToValueAtTime(gainValue, now2 + 0.01);
          gainNode.gain.exponentialRampToValueAtTime(gainValue * 0.3, now2 + 0.15);
          gainNode.gain.exponentialRampToValueAtTime(0.001, now2 + 0.5);
          
          osc.start(now2);
          osc.stop(now2 + 0.5);
        });
      }, 200);

      ringCount++;
    };

    // Play immediately and then every 800ms for ding-dong pattern
    playBellRing();
    soundIntervalRef.current = setInterval(playBellRing, 800);
  };

  // Stop sound when component unmounts or when all calls are handled
  useEffect(() => {
    return () => {
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
      }
    };
  }, []);

  const updateCallStatus = async (callId: string, status: "acknowledged" | "completed") => {
    try {
      const updateData: any = { status };
      if (status === "acknowledged") { updateData.acknowledged_at = new Date().toISOString(); updateData.acknowledged_by = onShift; }
      if (status === "completed") updateData.completed_at = new Date().toISOString();

      const { error } = await supabase
        .from("service_calls")
        .update(updateData)
        .eq("id", callId);

      if (error) throw error;

      // Optimistic update
      setCalls(prev => {
        if (status === "completed") {
          return prev.filter(c => c.id !== callId);
        }
        return prev.map(c => c.id === callId ? { ...c, ...updateData } : c);
      });

      const call = calls.find(c => c.id === callId);
      staffApi.log(restaurantId, onShift, "call_answered", { table: call?.table_number, status: status === "acknowledged" ? "on the way" : "done" });
      toast({
        title: status === "acknowledged" ? "Guest told you're on the way" : "Request done",
        description: status === "acknowledged" ? (onShift ? `They see "${onShift} is on the way".` : "Start your shift (top of the screen) so guests see your name.") : undefined,
        duration: 3000,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to update request",
        variant: "destructive",
      });
    }
  };

  const pendingCalls = calls.filter(c => c.status === "pending");

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  };

  const getTimeSince = (dateStr: string) => {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="w-12 h-12 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-28" />
                </div>
              </div>
              <Skeleton className="h-9 w-20 rounded-md" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center">
            <Bell className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Service calls</h2>
            <p className="text-sm text-muted-foreground">
              {calls.length === 0 ? "No active requests" : `${calls.length} active request${calls.length > 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        {pendingCalls.length > 0 && (
          <Badge className="tabular-nums">
            {pendingCalls.length} new
          </Badge>
        )}
      </div>

      {/* Calls List */}
      {calls.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-accent flex items-center justify-center">
            <Bell className="w-6 h-6 text-primary" />
          </div>
          <p className="font-semibold">No service requests</p>
          <p className="text-sm text-muted-foreground mt-1">
            Waiter, water, bill, help and cleaning requests from tables appear here
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {calls.map((call) => {
              const config = CALL_CONFIG[call.call_type] || CALL_CONFIG.waiter;
              const Icon = config.icon;
              const isPending = call.status === "pending";
              const escalated = isPending && now - new Date(call.created_at).getTime() > ESCALATE_MS;

              return (
                <motion.div
                  key={call.id}
                  layout
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 60 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Card className={`overflow-hidden ${escalated ? "border-destructive/60 ring-1 ring-destructive/30" : isPending ? "border-primary/50 ring-1 ring-primary/25" : ""}`}>
                    <div className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${isPending ? "bg-primary text-primary-foreground" : "bg-accent text-primary"}`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-display text-xl leading-tight">{locationLabel} {call.table_number}</span>
                              <Badge variant={isPending ? "default" : "secondary"}>
                                {config.label}
                              </Badge>
                            </div>
                            <p className={`text-sm flex items-center gap-1 tabular-nums ${escalated ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                              <Clock className="w-3 h-3" />
                              {formatTime(call.created_at)} · {getTimeSince(call.created_at)}
                              {escalated && " · nobody has answered"}
                              {call.status === "acknowledged" && ` · ${call.acknowledged_by || "Staff"} on the way`}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                        {isPending && (
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => {
                            if (soundIntervalRef.current) { clearInterval(soundIntervalRef.current); soundIntervalRef.current = null; }
                            updateCallStatus(call.id, "acknowledged");
                          }}>
                            <Footprints className="w-4 h-4" />
                            On my way
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => {
                            // Stop sound when marking as done
                            if (soundIntervalRef.current) {
                              clearInterval(soundIntervalRef.current);
                              soundIntervalRef.current = null;
                            }
                            updateCallStatus(call.id, "completed");
                          }}
                          className="gap-1 flex-shrink-0"
                        >
                          <Check className="w-4 h-4" />
                          Done
                        </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default ServiceCallsPanel;

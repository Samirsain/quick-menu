import { useEffect, useLayoutEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Minus, X, Search, Moon, Sun, Clock, ArrowRight, ArrowLeft, ChevronRight, Receipt, MoreVertical, ShoppingBag, Leaf,
  Instagram, Facebook, Twitter, Globe, Loader2, Star, CupSoda, IceCreamCone, ConciergeBell, Salad, Pizza, Croissant, UtensilsCrossed
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { isRateLimited, RATE_LIMITS, isValidUUID, isValidTableNumber, sanitizeInput, getClientFingerprint } from "@/lib/security";
import { registerReconnectCallback, unregisterReconnectCallback } from "@/lib/realtimeOptimization";
import ServiceCallButton from "@/components/ServiceCallButton";
import { VegMark, BestsellerBadge } from "@/components/FoodBadges";
import UpiPayCard from "@/components/UpiPayCard";
import { celebrate } from "@/lib/celebrate";
import CountUp from "@/components/CountUp";
import { useBusinessType } from "@/hooks/useBusinessType";

gsap.registerPlugin(ScrollTrigger);

const CustomerMenu = () => {
  const { restaurantId } = useParams();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { locationLabel, locationLabelLower } = useBusinessType(restaurantId || null);
  const [cart, setCart] = useState<any[]>([]);
  // Pre-fill table number from QR URL param (per-table QR mode)
  const [tableNumber, setTableNumber] = useState(() => searchParams.get("table") || "");
  const tableFromQR = searchParams.get("table"); // locked if came from per-table QR
  const [showOrderConfirmation, setShowOrderConfirmation] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackDismissed, setFeedbackDismissed] = useState(false); // Track if user dismissed feedback
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [reviewStep, setReviewStep] = useState<"rate" | "google">("rate");
  const [commentCopied, setCommentCopied] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<any>(null);
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCartDialog, setShowCartDialog] = useState(false);
  const [showOrderStatusDialog, setShowOrderStatusDialog] = useState(false);
  const [showOrderHistoryDialog, setShowOrderHistoryDialog] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  // Review popup replaces any open dialog so it is never hidden behind the cart/order sheets
  const openFeedback = () => {
    setShowCartDialog(false);
    setShowOrderConfirmation(false);
    setShowOrderStatusDialog(false);
    setShowOrderHistoryDialog(false);
    setShowFeedback(true);
  };
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('customer-menu-theme') === 'dark');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [vegOnly, setVegOnly] = useState(false);
  const [serviceDisabled, setServiceDisabled] = useState(false);
  const [restaurantContact, setRestaurantContact] = useState<{ name: string; email: string; phone: string | null } | null>(null);
  const [imageLoaded, setImageLoaded] = useState<Record<string, boolean>>({});
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const feedbackDismissedRef = useRef(false); // Ref for realtime callback access
  
  // Session management
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [remainingMinutes, setRemainingMinutes] = useState<number | null>(null);
  const sessionActivityRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get session ID from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const menuSessionId = urlParams.get('session');
  
  const sessionId = useRef(localStorage.getItem("session_id") || `session_${restaurantId}_${Date.now()}`).current;
  
  // Validate session on load and periodically
  useEffect(() => {
    if (!menuSessionId) {
      // No session - allow access for backward compatibility but show warning
      if (import.meta.env.DEV) console.log("⚠️ No session ID - direct access");
      return;
    }

    const validateSession = async () => {
      try {
        const { data, error } = await supabase.rpc("validate_menu_session", {
          p_session_id: menuSessionId,
        });

        if (error) {
          console.error("Session validation error:", error);
          return;
        }

        const result = data?.[0];
        if (!result) return;

        if (!result.is_valid) {
          setSessionExpired(true);
          setSessionError(result.error_message || "Session expired");
        } else {
          setRemainingMinutes(result.remaining_minutes);
        }
      } catch (err) {
        console.error("Session check failed:", err);
      }
    };

    // Validate immediately
    validateSession();

    // Validate every 2 minutes to update activity and check expiry
    sessionActivityRef.current = setInterval(validateSession, 2 * 60 * 1000);

    return () => {
      if (sessionActivityRef.current) {
        clearInterval(sessionActivityRef.current);
      }
    };
  }, [menuSessionId]);

  const formatINR = useCallback((value: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0)), []);

  // Subscription expired state
  const [subscriptionExpired, setSubscriptionExpired] = useState(false);

  // Production-optimized queries with proper cache management
  const { data: restaurant, isLoading: isLoadingRestaurant } = useQuery({
    queryKey: ['restaurant', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("social_links, name, description, logo_url, is_active, email, phone, orders_enabled, waiter_call_enabled, upi_id")
        .eq("id", restaurantId)
        .single();
      
      if (error) throw error;
      
      if (data && !data.is_active) {
        setServiceDisabled(true);
        setRestaurantContact({ name: data.name, email: data.email, phone: data.phone });
      }
      
      // Check subscription status
      if (restaurantId) {
        const { data: subStatus } = await supabase
          .rpc("get_restaurant_subscription_status" as any, { p_restaurant_id: restaurantId });
        const statusArray = subStatus as any[];
        
        if (!statusArray || statusArray.length === 0 || !statusArray[0].is_subscription_active) {
          setSubscriptionExpired(true);
          setRestaurantContact({ name: data?.name, email: data?.email, phone: data?.phone });
        }
      }
      
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    enabled: !!restaurantId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const ordersEnabled = restaurant?.orders_enabled !== false;
  const waiterCallEnabled = restaurant?.waiter_call_enabled !== false;
  const googleReviewRaw = (restaurant?.social_links as any)?.google_review;
  const googleReviewUrl: string | null = typeof googleReviewRaw === "string" && /^https:\/\//i.test(googleReviewRaw) ? googleReviewRaw : null;
  const upiId: string | null = restaurant?.upi_id || null;
  // What the table owes: rejected/cancelled orders are never billed
  const billTotal = useMemo(() => activeOrders
    .filter(o => o.status !== "rejected" && o.status !== "cancelled")
    .reduce((sum, o) => sum + (o.items?.items?.reduce((s: number, i: { price: number; quantity?: number }) => s + i.price * (i.quantity || 1), 0) || 0), 0),
  [activeOrders]);

  const { data: menuItems = [], isLoading: isLoadingItems } = useQuery({
    queryKey: ['menuItems', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_items")
        .select("id, restaurant_id, name, description, price, image_url, is_available, category_id, has_size_variants, size_variants, is_veg, is_bestseller")
        .eq("restaurant_id", restaurantId)
        .eq("is_available", true) // Only fetch available items for customers
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
    staleTime: 3 * 60 * 1000, // 3 minutes - shorter for menu items
    gcTime: 30 * 60 * 1000,
    enabled: !!restaurantId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
    queryKey: ['categories', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_categories")
        .select("id, restaurant_id, name, display_order")
        .eq("restaurant_id", restaurantId)
        .order("display_order", { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: !!restaurantId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const isLoading = isLoadingRestaurant || isLoadingItems || isLoadingCategories;

  const incrementViewMutation = useMutation({
    mutationFn: async () => {
      const { data: currentViews } = await supabase.from("menu_views").select("view_count").eq("restaurant_id", restaurantId).single();
      if (currentViews) {
        await supabase.from("menu_views").update({ view_count: currentViews.view_count + 1 }).eq("restaurant_id", restaurantId);
      }
    },
  });

  // Dark mode with pure black
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.setProperty('--background', '0 0% 0%');
      document.body.style.backgroundColor = '#000000';
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.removeProperty('--background');
      document.body.style.backgroundColor = '';
    }
    localStorage.setItem('customer-menu-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("session_id", sessionId);
    if (restaurantId) {
      cleanupOldOrders();
      incrementViewMutation.mutate();
      loadSessionOrder();
    }
  }, [restaurantId]);

  // Subscribe to realtime updates when we have active orders
  useEffect(() => {
    if (activeOrders.length > 0 && restaurantId) {
      const cleanup = subscribeToOrderUpdates();
      return cleanup;
    }
    // Re-subscribe when a new order joins the session so its status updates aren't ignored
  }, [activeOrders.length, restaurantId]);

  // Polling fallback - refresh orders every 10 seconds as backup (only when orders are incomplete)
  useEffect(() => {
    if (activeOrders.length === 0 || !restaurantId) return;
    
    const isAllDone = activeOrders.every(o => ['completed', 'rejected', 'cancelled'].includes(o.status));
    if (isAllDone) return; // Stop polling once all orders are in a terminal state

    const pollOrders = async () => {
      const orderIdsStr = localStorage.getItem(`orders_${restaurantId}_${sessionId}`);
      if (!orderIdsStr) return;
      const orderIds = JSON.parse(orderIdsStr);
      const { data: orders } = await supabase.from("orders").select("*").in("id", orderIds);
      if (orders && orders.length > 0) {
        setActiveOrders(orders);
        setCurrentOrder(orders[orders.length - 1]);
        // Only show feedback ONCE when all orders complete - use ref to check
        if (orders.every(o => o.status === 'completed') && !feedbackDismissedRef.current) {
          feedbackDismissedRef.current = true;
          setFeedbackDismissed(true);
          setTimeout(openFeedback, 500);
        }
      }
    };

    const interval = setInterval(pollOrders, 10000);
    return () => clearInterval(interval);
  }, [activeOrders.length, restaurantId, sessionId]);

  const cleanupOldOrders = () => {
    const orderIdsStr = localStorage.getItem(`orders_${restaurantId}_${sessionId}`);
    const orderTimestampStr = localStorage.getItem(`orders_timestamp_${restaurantId}_${sessionId}`);
    if (orderIdsStr && orderTimestampStr) {
      const timestamp = parseInt(orderTimestampStr);
      // Expire orders after 90 minutes (same as menu session)
      if (timestamp < Date.now() - 90 * 60 * 1000) {
        localStorage.removeItem(`orders_${restaurantId}_${sessionId}`);
        localStorage.removeItem(`orders_timestamp_${restaurantId}_${sessionId}`);
        setActiveOrders([]);
        setCurrentOrder(null);
      }
    }
  };

  const loadSessionOrder = async () => {
    const orderIdsStr = localStorage.getItem(`orders_${restaurantId}_${sessionId}`);
    if (orderIdsStr) {
      const orderIds = JSON.parse(orderIdsStr);
      const { data: orders } = await supabase.from("orders").select("*").in("id", orderIds);
      if (orders && orders.length > 0) {
        setActiveOrders(orders);
        setCurrentOrder(orders[orders.length - 1]);
        setTableNumber(orders[orders.length - 1].table_number);
        // Don't auto-show feedback on page load - let user view history first
      }
    }
  };

  const subscribeToOrderUpdates = () => {
    const orderIdsStr = localStorage.getItem(`orders_${restaurantId}_${sessionId}`);
    if (!orderIdsStr) return () => {};
    const orderIds: string[] = JSON.parse(orderIdsStr);
    if (orderIds.length === 0) return () => {};

    // Use unique channel name per session
    const channelName = `orders-${restaurantId}-${sessionId}`;
    
    // Remove any existing channel with same name first
    const existingChannels = supabase.getChannels();
    existingChannels.forEach(ch => {
      if (ch.topic.includes(channelName)) {
        supabase.removeChannel(ch);
      }
    });
    
    const setupChannel = () => {
      if (import.meta.env.DEV) console.log('📡 Setting up realtime for orders:', orderIds);
      const channel = supabase
        .channel(channelName, { config: { broadcast: { self: true } } })
        .on('postgres_changes', { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'orders',
          filter: `restaurant_id=eq.${restaurantId}`
        }, (payload: any) => {
          // Filter client-side for our specific orders
          if (!orderIds.includes(payload.new.id)) return;
          if (import.meta.env.DEV) console.log('📦 Order update received:', payload.new.id, payload.new.status);
          
          setActiveOrders(prev => {
            const updated = prev.map(order => order.id === payload.new.id ? { ...payload.new } : order);
            // Only show feedback ONCE when all orders complete
            if (updated.every(o => o.status === 'completed') && !feedbackDismissedRef.current) {
              feedbackDismissedRef.current = true;
              setFeedbackDismissed(true);
              setTimeout(openFeedback, 500);
            }
            return updated;
          });
          setCurrentOrder(prev => prev?.id === payload.new.id ? { ...payload.new } : prev);
          
          if (payload.new.status === "completed" && payload.old?.status !== "completed") {
            if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
            toast({ title: "Your order is ready", description: `Order #${payload.new.order_number} is on its way to your table.`, duration: 8000 });
          } else if (payload.new.status === "accepted" && payload.old?.status === "pending") {
            toast({ title: "Order accepted", description: `Order #${payload.new.order_number} has been confirmed.`, duration: 6000 });
          } else if (payload.new.status === "preparing" && payload.old?.status === "accepted") {
            toast({ title: "Being prepared", description: `The kitchen has started on order #${payload.new.order_number}.`, duration: 5000 });
          } else if (payload.new.status === "rejected") {
            if ('vibrate' in navigator) navigator.vibrate([300, 100, 300]);
            toast({ title: "Order not accepted", description: `Order #${payload.new.order_number} was declined. Please ask a member of staff.`, variant: "destructive", duration: 10000 });
          } else if (payload.new.status === "cancelled") {
            toast({ title: "Order cancelled", description: `Order #${payload.new.order_number} was cancelled.`, variant: "destructive", duration: 8000 });
          }
        })
        .subscribe((status, err) => {
          if (import.meta.env.DEV) console.log('📡 Realtime subscription status:', status, err || '');
        });
      return channel;
    };

    let channel = setupChannel();
    
    registerReconnectCallback(channelName, () => {
      try { supabase.removeChannel(channel); } catch (e) { /* ignore */ }
      channel = setupChannel();
    });

    return () => {
      unregisterReconnectCallback(channelName);
      try { supabase.removeChannel(channel); } catch (e) { /* ignore */ }
    };
  };

  // Cart functions - now with size variant support
  // Cart key is itemId + selectedSize to allow same item with different sizes
  const getCartItemKey = (itemId: string, selectedSize?: string) => selectedSize ? `${itemId}_${selectedSize}` : itemId;
  
  const getCartItemQuantity = useCallback((itemId: string, selectedSize?: string) => {
    const key = getCartItemKey(itemId, selectedSize);
    return cart.find(i => getCartItemKey(i.id, i.selectedSize) === key)?.quantity || 0;
  }, [cart]);

  // Get total quantity for an item (all sizes combined)
  const getTotalItemQuantity = useCallback((itemId: string) => {
    return cart.filter(i => i.id === itemId).reduce((sum, i) => sum + (i.quantity || 1), 0);
  }, [cart]);
  
  const addToCart = useCallback((item: any, selectedSize?: { name: string; price: number }) => {
    setCart(prev => {
      const cartKey = getCartItemKey(item.id, selectedSize?.name);
      const existing = prev.find(i => getCartItemKey(i.id, i.selectedSize) === cartKey);
      
      if (existing) {
        return prev.map(i => getCartItemKey(i.id, i.selectedSize) === cartKey 
          ? { ...i, quantity: (i.quantity || 1) + 1 } 
          : i
        );
      }
      
      // Add new item with size info
      const cartItem = {
        ...item,
        quantity: 1,
        selectedSize: selectedSize?.name,
        displayPrice: selectedSize?.price ?? item.price,
      };
      return [...prev, cartItem];
    });
  }, []);

  const updateQuantity = useCallback((itemId: string, delta: number, selectedSize?: string) => {
    const cartKey = getCartItemKey(itemId, selectedSize);
    setCart(prev => prev.map(item => {
      if (getCartItemKey(item.id, item.selectedSize) === cartKey) {
        const newQty = (item.quantity || 1) + delta;
        return newQty > 0 ? { ...item, quantity: newQty } : item;
      }
      return item;
    }).filter(item => item.quantity > 0));
  }, []);

  const removeFromCart = useCallback((itemId: string, selectedSize?: string) => {
    const cartKey = getCartItemKey(itemId, selectedSize);
    setCart(prev => prev.filter(item => getCartItemKey(item.id, item.selectedSize) !== cartKey));
  }, []);


  const placeOrder = async () => {
    // Prevent duplicate orders - if already placing, ignore
    if (isPlacingOrder) return;
    
    if (!tableNumber || cart.length === 0) {
      toast({ title: "Missing information", description: `Please enter ${locationLabelLower} number and add items`, variant: "destructive" });
      return;
    }
    if (!isValidTableNumber(tableNumber)) {
      toast({ title: `Invalid ${locationLabelLower} number`, description: `${locationLabel} number must be alphanumeric (max 10 chars)`, variant: "destructive" });
      return;
    }
    if (!restaurantId || !isValidUUID(restaurantId)) {
      toast({ title: "Invalid restaurant", description: "Please scan a valid QR code", variant: "destructive" });
      return;
    }
    if (isRateLimited(`order_${getClientFingerprint()}`, RATE_LIMITS.order)) {
      toast({ title: "Too many orders", description: "Please wait before placing another order", variant: "destructive" });
      return;
    }

    // Check network connectivity before placing order
    if (!navigator.onLine) {
      toast({ title: "No internet connection", description: "Please check your connection and try again", variant: "destructive" });
      return;
    }

    // Set loading state to prevent multiple clicks
    setIsPlacingOrder(true);

    try {
      const orderNum = `ORD${Date.now().toString().slice(-6)}`;
      const orderItems = cart.map(item => ({ 
        id: item.id, 
        name: item.name, 
        price: item.displayPrice ?? item.price, 
        quantity: item.quantity || 1, 
        image_url: item.image_url,
        selectedSize: item.selectedSize || null,
      }));
      
      // Add timeout to prevent hanging requests
      const orderPromise = supabase
        .from("orders")
        .insert([{ restaurant_id: restaurantId, table_number: tableNumber, items: { items: orderItems }, order_number: orderNum, status: 'pending', session_id: sessionId }])
        .select()
        .single();

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Order request timed out')), 15000)
      );

      const { data: newOrder, error } = await Promise.race([orderPromise, timeoutPromise]) as any;

      if (error) throw new Error(error.message);
      if (!newOrder) throw new Error('No order data returned');

      // Send notification to restaurant owner (client-side call for reliability)
      try {
        const notificationPromise = supabase.functions.invoke('send-order-notification', {
          body: { record: newOrder }
        });
        
        const notificationTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Notification timeout')), 10000)
        );

        const { error: notificationError } = await Promise.race([notificationPromise, notificationTimeout]) as any;
        
        if (notificationError) {
          console.warn('Notification failed:', notificationError);
          // Retry once after a short delay
          setTimeout(async () => {
            try {
              await supabase.functions.invoke('send-order-notification', {
                body: { record: newOrder }
              });
            } catch (retryErr) {
              console.warn('Notification retry failed:', retryErr);
            }
          }, 2000);
        }
      } catch (notifErr) {
        console.warn('Notification error:', notifErr);
        // Don't fail the order if notification fails
      }

      setActiveOrders(prev => [...prev, newOrder]);
      setCurrentOrder(newOrder);
      setOrderNumber(orderNum);
      
      const existingOrders = localStorage.getItem(`orders_${restaurantId}_${sessionId}`);
      const orderIds = existingOrders ? JSON.parse(existingOrders) : [];
      orderIds.push(newOrder.id);
      localStorage.setItem(`orders_${restaurantId}_${sessionId}`, JSON.stringify(orderIds));
      if (!existingOrders) localStorage.setItem(`orders_timestamp_${restaurantId}_${sessionId}`, Date.now().toString());
      
      setCart([]);
      setShowCartDialog(false);
      setShowOrderConfirmation(true);
      celebrate();
      toast({ title: "Order placed", description: `Order #${orderNum} has been sent to the kitchen.`, duration: 5000 });
    } catch (err: any) {
      console.error('Order placement error:', err);
      toast({ 
        title: "Failed to create order", 
        description: err.message === 'Order request timed out' 
          ? "Request timed out. Please check your connection and try again." 
          : err.message || "Please try again.", 
        variant: "destructive" 
      });
    } finally {
      // Always reset loading state
      setIsPlacingOrder(false);
    }
  };

  const submitFeedback = async () => {
    if (!currentOrder?.id) return;
    if (isRateLimited(`feedback_${getClientFingerprint()}`, RATE_LIMITS.feedback)) {
      toast({ title: "Too many submissions", description: "Please wait", variant: "destructive" });
      return;
    }
    await supabase.from("feedback").insert([{ order_id: currentOrder.id, restaurant_id: restaurantId, rating, comment: sanitizeInput(comment.trim()) || null }]);
    // Mark feedback as submitted for this order but DON'T clear orders - they persist for 90 mins
    localStorage.setItem(`feedback_submitted_${currentOrder.id}`, 'true');
    // Every rating (not just good ones) gets the Google ask - filtering by rating is "review gating", which Google bans
    if (googleReviewUrl) {
      if (comment.trim()) {
        navigator.clipboard?.writeText(comment.trim()).then(() => setCommentCopied(true)).catch(() => {});
      }
      setReviewStep("google");
      return;
    }
    toast({ title: "Thank you!", description: "Your feedback helps us improve!", duration: 4000 });
    setShowFeedback(false);
    setRating(0);
    setComment("");
    // Keep activeOrders and currentOrder - user can still view history for 90 mins
  };

  // Skip feedback - just close dialog without clearing orders
  const skipFeedback = () => {
    setShowFeedback(false);
    setFeedbackDismissed(true); // Don't show feedback again this session
    feedbackDismissedRef.current = true; // Also update ref for realtime callback
    setRating(0);
    setComment("");
    setReviewStep("rate");
    setCommentCopied(false);
    // Orders remain visible in history for 90 mins
  };

  // Memoized data - filter out unavailable items
  const availableMenuItems = useMemo(
    () => menuItems.filter(item => item.is_available && (!vegOnly || item.is_veg !== false)),
    [menuItems, vegOnly]
  );
  // Only offer the Veg filter when the menu actually mixes veg and non-veg
  const showVegFilter = useMemo(
    () => menuItems.some(i => i.is_veg === true) && menuItems.some(i => i.is_veg === false),
    [menuItems]
  );

  const groupedItems = useMemo(() => categories.reduce((acc, cat) => {
    acc[cat.id] = availableMenuItems.filter(item => item.category_id === cat.id);
    return acc;
  }, {} as Record<string, any[]>), [categories, availableMenuItems]);

  const uncategorizedItems = useMemo(() => availableMenuItems.filter(item => !item.category_id), [availableMenuItems]);

  // Filter items based on selected category
  const displayedCategories = useMemo(() => {
    const catsWithItems = categories.filter(c => groupedItems[c.id]?.length > 0);
    if (selectedCategory) {
      return catsWithItems.filter(c => c.id === selectedCategory);
    }
    return catsWithItems;
  }, [categories, groupedItems, selectedCategory]);

  const searchResults = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    return availableMenuItems.filter(item => item.name.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q));
  }, [availableMenuItems, searchQuery]);

  const totalPrice = useMemo(() => cart.reduce((sum, item) => sum + ((item.displayPrice ?? item.price) * (item.quantity || 1)), 0), [cart]);
  const totalItems = useMemo(() => cart.reduce((sum, item) => sum + (item.quantity || 1), 0), [cart]);

  const handleCategoryClick = (categoryId: string | null) => {
    setSelectedCategory(categoryId);
    setSearchQuery("");
  };

  // ---- Motion (GSAP). Hooks live above the early returns so hook order never changes.
  const heroRef = useRef<HTMLElement>(null);
  const heroImgRef = useRef<HTMLImageElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [heroVisible, setHeroVisible] = useState(true);

  // Hero: image settles in, text staggers up, image drifts slower than the page (parallax)
  useLayoutEffect(() => {
    if (showSplash || !heroRef.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from(heroImgRef.current, { scale: 1.12, duration: 1.6, ease: "power2.out" });
      gsap.from("[data-hero]", { y: 26, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.08, delay: 0.1 });
      gsap.to(heroImgRef.current, {
        yPercent: 12,
        ease: "none",
        scrollTrigger: { trigger: heroRef.current, start: "top top", end: "bottom top", scrub: true },
      });
    }, heroRef);
    return () => ctx.revert();
  }, [showSplash]);

  // Section headers and dish cards fade + slide up as they scroll in; photos scale down into place
  useLayoutEffect(() => {
    if (showSplash || isLoadingItems || !listRef.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.set("[data-reveal]", { opacity: 0, y: 22 });
      ScrollTrigger.batch("[data-reveal]", {
        start: "top 94%",
        once: true,
        onEnter: (els) => {
          gsap.to(els, { opacity: 1, y: 0, duration: 0.75, ease: "power3.out", stagger: 0.07, overwrite: true });
          const imgs = els.map(el => el.querySelector("[data-reveal-img]")).filter(Boolean);
          if (imgs.length) gsap.fromTo(imgs, { scale: 1.18 }, { scale: 1, duration: 1.1, ease: "power3.out", stagger: 0.07 });
        },
      });
    }, listRef);
    return () => ctx.revert();
  }, [showSplash, isLoadingItems, displayedCategories, searchQuery]);

  // Compact header slides in once the hero has scrolled away
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting), { rootMargin: "-120px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [showSplash]);

  // Splash Screen
  if (showSplash) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-menu-bg">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE }} className="text-center px-8">
          {restaurant?.logo_url ? (
            <img src={restaurant.logo_url} alt="" className="w-16 h-16 mx-auto mb-6 rounded-full object-cover ring-1 ring-menu-line" />
          ) : (
            <span className="mx-auto mb-6 h-16 w-16 rounded-full bg-menu-tint text-menu-accent flex items-center justify-center"><Leaf className="h-7 w-7" strokeWidth={1.5} /></span>
          )}
          <h1 className="font-display text-4xl tracking-tight text-menu-ink">{restaurant?.name || "Menu"}</h1>
          <div className="relative h-px w-24 mx-auto mt-8 overflow-hidden bg-menu-line">
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-y-0 w-1/2 bg-menu-accent"
            />
          </div>
        </motion.div>
      </div>
    );
  }

  // Service Disabled / Subscription Expired / Session Expired share one calm layout
  const blocked = serviceDisabled && restaurantContact
    ? { title: "Menu unavailable", body: `${restaurantContact.name}'s menu is currently unavailable.`, contact: false }
    : subscriptionExpired && restaurantContact
      ? { title: "Menu temporarily unavailable", body: `${restaurantContact.name}'s digital menu is currently inactive. Please contact the restaurant.`, contact: true }
      : sessionExpired
        ? { title: "Session ended", body: sessionError || "Your menu session has ended. Scan the QR code on your table to start again.", contact: false }
        : null;

  if (blocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-menu-bg text-menu-ink p-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} className="max-w-sm text-center">
          <div className="w-12 h-12 mx-auto mb-6 rounded-full bg-menu-tint text-menu-accent flex items-center justify-center">
            <Clock className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <h1 className="font-display text-3xl tracking-tight">{blocked.title}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-menu-muted">{blocked.body}</p>
          {blocked.contact && (
            <div className="mt-6 space-y-1 text-sm">
              {restaurantContact?.email && <a href={`mailto:${restaurantContact.email}`} className="block text-menu-accent underline underline-offset-4">{restaurantContact.email}</a>}
              {restaurantContact?.phone && <a href={`tel:${restaurantContact.phone}`} className="block text-menu-accent underline underline-offset-4">{restaurantContact.phone}</a>}
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  const restaurantName = restaurant?.name || "Menu";
  const social = (restaurant?.social_links || {}) as Record<string, string | undefined>;
  const socialLinks = [
    { key: "instagram", Icon: Instagram, label: "Instagram" },
    { key: "facebook", Icon: Facebook, label: "Facebook" },
    { key: "twitter", Icon: Twitter, label: "Twitter" },
    { key: "website", Icon: Globe, label: "Website" },
  ].filter(s => typeof social[s.key] === "string" && /^https:\/\//i.test(social[s.key]!));
  const status = overallStatus(activeOrders);
  const itemCount = activeOrders.reduce((sum, o) => sum + (o.items?.items?.reduce((s: number, i: { quantity?: number }) => s + (i.quantity || 1), 0) || 0), 0);
  const allSettled = activeOrders.length > 0 && activeOrders.every(o => ["completed", "rejected", "cancelled"].includes(o.status));
  const tabs = [{ id: null as string | null, name: "All" }, ...categories.filter(c => groupedItems[c.id]?.length > 0).map(c => ({ id: c.id as string | null, name: c.name as string }))];
  const canGoBack = window.history.length > 1;
  const cardProps = { onAdd: addToCart, onUpdate: updateQuantity, formatINR, getCartQtyBySize: getCartItemQuantity, ordersEnabled };
  const openSearch = () => { setIsSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 100); };
  const selectCategory = (id: string | null) => {
    handleCategoryClick(id);
    // Land at the top of the menu sheet, not the top of the page
    const top = (heroRef.current?.offsetHeight ?? 0) - 120;
    if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
  };

  const pills = (tone: "dark" | "light") => (
    <CategoryPills
      tone={tone}
      tabs={tabs}
      isSelected={(id) => (id === null ? selectedCategory === null && !searchQuery : selectedCategory === id)}
      onSelect={selectCategory}
      showVeg={showVegFilter}
      vegOnly={vegOnly}
      onToggleVeg={() => setVegOnly(v => !v)}
    />
  );

  const moreMenu = (tone: "dark" | "light") => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="More options" className={tone === "dark" ? GLASS_ACCENT : GHOST}>
          <MoreVertical className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 rounded-2xl border-menu-line bg-menu-card text-menu-ink p-1.5">
        <DropdownMenuItem onClick={() => setIsDarkMode(!isDarkMode)} className="rounded-xl gap-2.5 py-2.5">
          {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{isDarkMode ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        {activeOrders.length > 0 && (
          <DropdownMenuItem onClick={() => setShowOrderHistoryDialog(true)} className="rounded-xl gap-2.5 py-2.5">
            <Receipt className="h-4 w-4" />Your orders & bill
          </DropdownMenuItem>
        )}
        {googleReviewUrl && (
          <DropdownMenuItem onClick={() => window.open(googleReviewUrl, "_blank", "noopener,noreferrer")} className="rounded-xl gap-2.5 py-2.5">
            <Star className="h-4 w-4" />Review us on Google
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Items + total + table + place order. Shared by the phone cart sheet and the desktop order panel.
  const orderSummary = (
    <>
      {cart.length === 0 ? (
        <p className="py-8 text-center text-sm text-menu-muted">Add a dish to start your order.</p>
      ) : (<>
        <div className="divide-y divide-menu-line">
          {cart.map((item) => {
            const cartKey = item.selectedSize ? `${item.id}_${item.selectedSize}` : item.id;
            const itemPrice = item.displayPrice ?? item.price;
            return (
              <motion.div key={cartKey} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-3.5 flex items-center gap-3">
                {item.image_url && <img src={item.image_url} alt="" className="h-12 w-12 rounded-xl object-cover flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-display text-[16px] leading-snug truncate">{item.name}</p>
                  <p className="text-xs text-menu-muted mt-0.5">{item.selectedSize && <span>{item.selectedSize} · </span>}{formatINR(itemPrice)}</p>
                </div>
                <QtyPill qty={item.quantity || 1} onMinus={() => updateQuantity(item.id, -1, item.selectedSize)} onPlus={() => updateQuantity(item.id, 1, item.selectedSize)} small />
              </motion.div>
            );
          })}
        </div>
      <div className="pt-4 mt-1 border-t border-menu-line space-y-4">
        <div className="flex justify-between items-baseline">
          <span className="text-sm text-menu-muted">Total</span>
          <span className="font-display text-[26px] tabular-nums">{formatINR(totalPrice)}</span>
        </div>
        <div>
          <label htmlFor="table-no" className="text-[11px] uppercase tracking-[0.16em] text-menu-muted">{locationLabel}</label>
          <input
            id="table-no"
            value={tableNumber}
            onChange={(e) => !tableFromQR && setTableNumber(e.target.value)}
            placeholder={`Enter ${locationLabelLower} number`}
            readOnly={!!tableFromQR}
            className={`mt-2 w-full h-11 px-4 rounded-xl border border-menu-line bg-menu-card text-[15px] outline-none focus:border-menu-accent/60 transition-colors ${tableFromQR ? "text-menu-muted" : ""}`}
          />
          {tableFromQR && <p className="text-xs text-menu-muted mt-1.5">Detected from the QR code on your table</p>}
        </div>
        <PrimaryButton onClick={placeOrder} disabled={!tableNumber || cart.length === 0 || isPlacingOrder}>
          {isPlacingOrder ? <><Loader2 className="w-4 h-4 animate-spin" /> Placing order</> : <>Place order · {formatINR(totalPrice)}</>}
        </PrimaryButton>
      </div>
      </>)}
    </>
  );

  return (
    <div className="min-h-screen bg-menu-bg text-menu-ink antialiased">
      {/* Compact header: appears once the hero is scrolled away, or while searching */}
      <AnimatePresence>
        {(!heroVisible || isSearchOpen) && (
          <motion.header
            initial={{ y: "-100%" }}
            animate={{ y: 0 }}
            exit={{ y: "-100%" }}
            transition={{ duration: 0.45, ease: EASE }}
            className="fixed top-0 inset-x-0 z-50 bg-menu-bg/85 backdrop-blur-xl border-b border-menu-line/80"
          >
            <div className="max-w-6xl mx-auto px-4 lg:px-8">
              <div className="h-14 flex items-center gap-3">
                {isSearchOpen ? (
                  <>
                    <div className="relative flex-1">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-menu-muted" strokeWidth={1.75} />
                      <input
                        ref={searchInputRef}
                        type="search"
                        placeholder="Search dishes"
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setSelectedCategory(null); }}
                        className="w-full h-10 pl-10 pr-4 rounded-full bg-menu-card border border-menu-line text-[15px] placeholder:text-menu-muted outline-none focus:border-menu-accent/60 transition-colors"
                        autoFocus
                      />
                    </div>
                    <button onClick={() => { setIsSearchOpen(false); setSearchQuery(""); }} className="h-10 px-1 text-sm font-medium text-menu-accent">Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 flex items-center gap-2">
                      <Leaf className="h-4 w-4 text-green-700 flex-shrink-0" strokeWidth={2} />
                      <span className="font-display text-[19px] truncate">{restaurantName}</span>
                    </span>
                    <button onClick={openSearch} aria-label="Search" className={GHOST}><Search className="h-[18px] w-[18px]" strokeWidth={1.75} /></button>
                    {waiterCallEnabled && <ServiceCallButton inline triggerClassName={GHOST} restaurantId={restaurantId || ""} tableNumber={tableNumber} />}
                    {moreMenu("light")}
                  </>
                )}
              </div>
              {!isSearchOpen && <div className="pb-3">{pills("light")}</div>}
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* Hero */}
      <section ref={heroRef} className="relative overflow-hidden bg-menu-hero">
        <img ref={heroImgRef} src={HERO_COVER} alt="" className="absolute inset-x-0 top-0 h-[115%] w-full object-cover object-[center_75%]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/30 to-black/85" />
        <div className="relative max-w-6xl mx-auto px-4 lg:px-8">
          <div className="h-16 flex items-center justify-between">
            {canGoBack ? (
              <button onClick={() => window.history.back()} aria-label="Back" className={GLASS_LIGHT}><ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2} /></button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button onClick={openSearch} aria-label="Search" className={GLASS_ACCENT}><Search className="h-[18px] w-[18px]" strokeWidth={2} /></button>
              {waiterCallEnabled && <ServiceCallButton inline triggerClassName={GLASS_ACCENT} restaurantId={restaurantId || ""} tableNumber={tableNumber} />}
              {moreMenu("dark")}
            </div>
          </div>
          <div className="pt-20 sm:pt-24 lg:pt-36 pb-12">
            <p data-hero className="text-[11px] font-medium uppercase tracking-[0.24em] text-white/60">
              {tableNumber ? `${locationLabel} ${tableNumber}` : "Menu"}
            </p>
            <div data-hero className="mt-2.5 flex items-center gap-3">
              {restaurant?.logo_url ? (
                <img src={restaurant.logo_url} alt="" className="h-10 w-10 rounded-full object-cover ring-2 ring-white/20" />
              ) : (
                <Leaf className="h-7 w-7 text-green-500 flex-shrink-0" strokeWidth={2} fill="currentColor" fillOpacity={0.25} />
              )}
              <h1 className="font-display text-[38px] sm:text-[48px] lg:text-[64px] leading-[1.04] tracking-[-0.015em] text-[#FBF4EA]">{restaurantName}</h1>
            </div>
            {restaurant?.description && (
              <p data-hero className="mt-2 max-w-lg text-[15px] leading-relaxed text-white/75">{restaurant.description}</p>
            )}
            <div data-hero className="mt-7">{pills("dark")}</div>
          </div>
        </div>
      </section>

      {/* Menu sheet, overlapping the hero */}
      <div className="relative z-10 -mt-7 rounded-t-[28px] bg-menu-bg">
        <div
          ref={listRef}
          className={`max-w-6xl mx-auto px-4 lg:px-8 pt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10 ${activeOrders.length > 0 && cart.length > 0 ? "pb-48" : activeOrders.length > 0 || cart.length > 0 ? "pb-32" : "pb-10"} lg:pb-16`}
        >
          <main className="min-w-0">
            {searchQuery && (
              <section>
                <p className="text-sm text-menu-muted mb-4">
                  {searchResults.length > 0 ? `${searchResults.length} ${searchResults.length === 1 ? "dish" : "dishes"} for “${searchQuery}”` : `Nothing found for “${searchQuery}”`}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {searchResults.map((item) => <DishCard key={item.id} item={item} cartQty={getTotalItemQuantity(item.id)} {...cardProps} />)}
                </div>
              </section>
            )}

            {!searchQuery && (
              <div className="space-y-10">
                {displayedCategories.map((category) => {
                  const items = groupedItems[category.id] || [];
                  return (
                    <section key={category.id}>
                      <SectionHeader
                        name={category.name}
                        count={items.length}
                        onViewAll={selectedCategory ? undefined : () => selectCategory(category.id)}
                      />
                      <div className="grid gap-3 md:grid-cols-2">
                        {items.map((item) => <DishCard key={item.id} item={item} cartQty={getTotalItemQuantity(item.id)} {...cardProps} />)}
                      </div>
                    </section>
                  );
                })}

                {uncategorizedItems.length > 0 && !selectedCategory && (
                  <section>
                    <SectionHeader name="More" count={uncategorizedItems.length} />
                    <div className="grid gap-3 md:grid-cols-2">
                      {uncategorizedItems.map((item) => <DishCard key={item.id} item={item} cartQty={getTotalItemQuantity(item.id)} {...cardProps} />)}
                    </div>
                  </section>
                )}
              </div>
            )}

            {isLoadingItems && (
              <div className="space-y-3" aria-label="Loading menu">
                <div className="h-10 w-44 rounded-xl bg-menu-line/70 animate-pulse mb-4" />
                {[0, 1, 2, 3].map(r => (
                  <div key={r} className="flex h-[116px] rounded-[20px] overflow-hidden bg-menu-card border border-menu-line/70">
                    <div className="w-[118px] bg-menu-line/60 animate-pulse" />
                    <div className="flex-1 p-4 space-y-2.5">
                      <div className="h-4 w-1/2 rounded bg-menu-line/70 animate-pulse" />
                      <div className="h-4 w-14 rounded bg-menu-line/70 animate-pulse" />
                      <div className="h-3 w-3/4 rounded bg-menu-line/50 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isLoadingItems && (
              <footer className="mt-16 pt-10 border-t border-menu-line text-center">
                {googleReviewUrl && (
                  <a
                    href={googleReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-menu-card border border-menu-line text-sm font-medium hover:border-menu-accent/50 transition-colors"
                  >
                    <GoogleG className="h-4 w-4" />
                    Enjoyed it? Review us on Google
                  </a>
                )}
                {socialLinks.length > 0 && (
                  <div className="mt-6 flex justify-center gap-5">
                    {socialLinks.map(({ key, Icon, label }) => (
                      <a key={key} href={social[key]} target="_blank" rel="noopener noreferrer" aria-label={label} className="text-menu-muted hover:text-menu-accent transition-colors">
                        <Icon className="w-[18px] h-[18px]" strokeWidth={1.5} />
                      </a>
                    ))}
                  </div>
                )}
                <p className="mt-8 pb-4 text-[11px] uppercase tracking-[0.2em] text-menu-muted/70">Powered by AddMenu</p>
              </footer>
            )}
          </main>

          {/* Desktop: order panel instead of the bottom cart bar */}
          <aside className="hidden lg:block">
            <div className="sticky top-[132px] rounded-[24px] bg-menu-card border border-menu-line p-6 shadow-[0_24px_60px_-30px_rgba(43,29,20,0.35)]">
              {activeOrders.length > 0 && (
                <button onClick={() => setShowOrderStatusDialog(true)} className="mb-5 w-full flex items-center gap-3 rounded-2xl bg-menu-tint/60 px-4 py-3 text-left hover:bg-menu-tint transition-colors">
                  <StatusDot status={status} />
                  <span className="flex-1 min-w-0 text-sm font-medium truncate">{STATUS_META[status].label}</span>
                  <ChevronRight className="h-4 w-4 text-menu-muted" />
                </button>
              )}
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-[26px] leading-none">Your order</h3>
                {activeOrders.length > 0 && (
                  <button onClick={() => setShowOrderHistoryDialog(true)} className="text-xs font-medium text-menu-accent hover:underline underline-offset-4">Orders & bill</button>
                )}
              </div>
              {ordersEnabled ? <div className="mt-3">{orderSummary}</div> : <p className="mt-3 text-sm text-menu-muted">Please order with a member of staff.</p>}
            </div>
          </aside>
        </div>
      </div>

      {/* Phone: cart bar */}
      <AnimatePresence>
        {cart.length > 0 && ordersEnabled && (
          <motion.div
            initial={{ y: 110, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 110, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className={`lg:hidden fixed inset-x-3 z-50 ${activeOrders.length > 0 ? "bottom-[80px]" : "bottom-3"}`}
          >
            <button
              onClick={() => setShowCartDialog(true)}
              className="w-full max-w-xl mx-auto flex items-center rounded-[26px] p-2 pl-5 bg-gradient-to-r from-menu-accent to-menu-accent-2 text-[#FBF4EA] shadow-[0_22px_44px_-18px_rgba(138,58,30,0.75)] active:scale-[0.99] transition-transform"
            >
              <motion.span key={totalItems} initial={{ rotate: -12, scale: 0.9 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
                <ShoppingBag className="h-[22px] w-[22px]" strokeWidth={1.75} />
              </motion.span>
              <span className="ml-3.5 text-left">
                <span className="block text-[17px] font-semibold leading-tight tabular-nums"><CountUp value={totalPrice} format={formatINR} duration={0.5} /></span>
                <span className="block text-xs opacity-80">{totalItems} {totalItems === 1 ? "item" : "items"}</span>
              </span>
              <span className="ml-auto mr-4 h-8 w-px bg-white/25" />
              <span className="h-12 px-6 rounded-[20px] bg-[#FBF1E6] text-menu-accent-2 text-[15px] font-semibold flex items-center gap-2">
                View order <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phone: order status bar */}
      <AnimatePresence>
        {activeOrders.length > 0 && (
          <motion.div
            initial={{ y: 90 }}
            animate={{ y: 0 }}
            exit={{ y: 90 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-menu-card/90 backdrop-blur-xl border-t border-menu-line"
          >
            <button onClick={() => setShowOrderStatusDialog(true)} className="w-full px-5 h-[68px] flex items-center justify-between gap-4 text-left">
              <span className="flex items-center gap-3 min-w-0">
                <StatusDot status={status} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium truncate">{STATUS_META[status].label}</span>
                  <span className="block text-xs text-menu-muted truncate">
                    {activeOrders.length === 1 ? `Order #${activeOrders[0].order_number}` : `${activeOrders.length} orders`} · {itemCount} {itemCount === 1 ? "item" : "items"}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[15px] font-semibold tabular-nums">{formatINR(billTotal)}</span>
                <ChevronRight className="w-4 h-4 text-menu-muted" />
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cart sheet (phone) */}
      <Dialog open={showCartDialog} onOpenChange={setShowCartDialog}>
        <DialogContent aria-describedby={undefined} className={`${SHEET} [&>button]:hidden`}>
          <SheetHeader title="Your order" onClose={() => setShowCartDialog(false)} />
          <ScrollArea className="max-h-[70vh]">
            <div className="px-6 pb-6">{orderSummary}</div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Order status */}
      <Dialog open={showOrderStatusDialog} onOpenChange={setShowOrderStatusDialog}>
        <DialogContent aria-describedby={undefined} className={`${SHEET} [&>button]:hidden`}>
          <DialogTitle className="sr-only">Order status</DialogTitle>
          <div className="px-6 pt-7 pb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-menu-muted">{locationLabel} {activeOrders[0]?.table_number}</p>
                <h2 className="mt-2 font-display text-[30px] leading-tight">{STATUS_META[status].title}</h2>
              </div>
              <CloseButton onClick={() => setShowOrderStatusDialog(false)} />
            </div>
            {STATUS_META[status].step >= 0 ? <OrderProgress step={STATUS_META[status].step} /> : (
              <p className="mt-4 text-sm text-menu-muted">Please ask a member of staff for help.</p>
            )}
          </div>
          <ScrollArea className="max-h-[36vh] border-t border-menu-line">
            <div className="px-6 divide-y divide-menu-line">
              {activeOrders.map((order) => <OrderBlock key={order.id} order={order} formatINR={formatINR} />)}
            </div>
          </ScrollArea>
          <div className="px-6 pt-4 pb-6 border-t border-menu-line space-y-3">
            {upiId && billTotal > 0 && allSettled && (
              <UpiPayCard upiId={upiId} payee={restaurantName} amount={billTotal} note={`${locationLabel} ${tableNumber}`} />
            )}
            <SecondaryButton onClick={() => setShowOrderStatusDialog(false)}>Close</SecondaryButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order placed */}
      <Dialog open={showOrderConfirmation} onOpenChange={setShowOrderConfirmation}>
        <DialogContent aria-describedby={undefined} className={`${SHEET} max-w-sm [&>button]:hidden`}>
          <DialogTitle className="sr-only">Order placed</DialogTitle>
          <div className="px-6 pt-10 pb-6 text-center">
            <DrawnCheck />
            <h2 className="mt-6 font-display text-[32px] leading-tight">Order placed</h2>
            <p className="mt-2 text-sm text-menu-muted">#{orderNumber} · {locationLabel} {tableNumber}</p>
            <p className="mt-5 text-[15px] leading-relaxed text-menu-ink/80">We've sent it to the kitchen. You'll see updates here as it's prepared.</p>
          </div>
          <div className="px-6 pb-6">
            <PrimaryButton onClick={() => setShowOrderConfirmation(false)}>Continue browsing</PrimaryButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Feedback → Google review */}
      <Dialog open={showFeedback} onOpenChange={skipFeedback}>
        <DialogContent aria-describedby={undefined} className={`${SHEET} max-w-sm [&>button]:hidden`}>
          <DialogTitle className="sr-only">Rate your experience</DialogTitle>
          {reviewStep === "google" && googleReviewUrl ? (
            <div className="px-6 pt-9 pb-6 text-center">
              <div className="flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <Star key={i} className={`h-5 w-5 ${i <= rating ? "text-amber-500 fill-amber-500" : "text-menu-line"}`} strokeWidth={1.5} />
                ))}
              </div>
              <h2 className="mt-5 font-display text-[30px] leading-tight">Thank you</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-menu-ink/80">
                Would you share this on Google? It takes a moment and helps others find {restaurantName}.
              </p>
              {commentCopied && <p className="mt-3 text-xs text-menu-muted">Your note is copied. Just paste it there.</p>}
              <div className="mt-7 space-y-2">
                <button
                  onClick={() => { window.open(googleReviewUrl, "_blank", "noopener,noreferrer"); skipFeedback(); }}
                  className="w-full h-12 rounded-2xl bg-menu-card border border-menu-line text-[15px] font-medium flex items-center justify-center gap-2.5 hover:border-menu-accent/50 active:scale-[0.99] transition"
                >
                  <GoogleG className="h-5 w-5" />
                  Review on Google
                </button>
                <button onClick={skipFeedback} className="w-full h-10 text-sm text-menu-muted hover:text-menu-ink transition-colors">Not now</button>
              </div>
            </div>
          ) : (
            <div className="px-6 pt-9 pb-6">
              <h2 className="text-center font-display text-[30px] leading-tight">How was your meal?</h2>
              <p className="mt-2 text-center text-sm text-menu-muted">Your rating goes straight to {restaurantName}.</p>
              <StarRating value={rating} onChange={setRating} />
              <textarea
                placeholder="Anything you'd like to tell us? (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-2xl border border-menu-line bg-menu-card text-[15px] placeholder:text-menu-muted outline-none focus:border-menu-accent/60 resize-none transition-colors"
              />
              <div className="mt-4 space-y-2">
                <PrimaryButton onClick={submitFeedback} disabled={rating === 0}>Submit</PrimaryButton>
                <button onClick={skipFeedback} className="w-full h-10 text-sm text-menu-muted hover:text-menu-ink transition-colors">Maybe later</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Order history + bill */}
      <Dialog open={showOrderHistoryDialog} onOpenChange={setShowOrderHistoryDialog}>
        <DialogContent aria-describedby={undefined} className={`${SHEET} [&>button]:hidden`}>
          <SheetHeader title="Your orders" onClose={() => setShowOrderHistoryDialog(false)} />
          <div className="px-6 pb-5 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-menu-muted">Total</p>
              <p className="mt-1 font-display text-[28px] tabular-nums">{formatINR(billTotal)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-[0.18em] text-menu-muted">Items</p>
              <p className="mt-1 font-display text-[28px] tabular-nums">{itemCount}</p>
            </div>
            <p className="col-span-2 -mt-2 text-xs text-menu-muted">{locationLabel} {tableNumber} · session ends in about {remainingMinutes || 90} min</p>
          </div>
          <ScrollArea className="max-h-[42vh] border-t border-menu-line">
            <div className="px-6 divide-y divide-menu-line">
              {activeOrders.map((order) => <OrderBlock key={order.id} order={order} formatINR={formatINR} showStatus />)}
            </div>
          </ScrollArea>
          {upiId && billTotal > 0 && (
            <div className="px-6 pt-4 pb-6 border-t border-menu-line">
              <UpiPayCard upiId={upiId} payee={restaurantName} amount={billTotal} note={`${locationLabel} ${tableNumber}`} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ---------- Presentational pieces ----------

const EASE = [0.22, 1, 0.36, 1] as const;
// ponytail: one default cover for every restaurant; add a cover upload in Settings when owners ask for it
const HERO_COVER = "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=1600&q=70&auto=format&fit=crop";
const SHEET = "max-w-md w-[94vw] p-0 gap-0 rounded-[28px] overflow-hidden border border-menu-line bg-menu-bg text-menu-ink shadow-[0_30px_80px_-20px_rgba(43,29,20,0.4)] z-[200]";
const GLASS_LIGHT = "h-10 w-10 rounded-full bg-white/95 text-[#2B1D14] flex items-center justify-center shadow-sm active:scale-95 transition-transform";
const GLASS_ACCENT = "relative h-10 w-10 rounded-full bg-menu-accent/55 backdrop-blur-md ring-1 ring-white/15 text-white flex items-center justify-center hover:bg-menu-accent/70 active:scale-95 transition";
const GHOST = "relative h-9 w-9 rounded-full flex items-center justify-center text-menu-ink/80 hover:bg-menu-ink/5 transition-colors";
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type OrderStatus = "pending" | "accepted" | "preparing" | "completed" | "rejected" | "cancelled";
const STATUS_META: Record<OrderStatus, { label: string; title: string; dot: string; step: number }> = {
  pending: { label: "Waiting for the kitchen to confirm", title: "Order sent", dot: "bg-amber-500", step: 0 },
  accepted: { label: "Order confirmed", title: "Confirmed", dot: "bg-sky-500", step: 1 },
  preparing: { label: "Being prepared", title: "In the kitchen", dot: "bg-orange-500", step: 2 },
  completed: { label: "Ready. Enjoy your meal", title: "Enjoy your meal", dot: "bg-emerald-500", step: 3 },
  rejected: { label: "Order not accepted", title: "Order not accepted", dot: "bg-red-500", step: -1 },
  cancelled: { label: "Order cancelled", title: "Order cancelled", dot: "bg-red-500", step: -1 },
};
const STEPS = ["Sent", "Confirmed", "Preparing", "Ready"];

// Same priority the old status bar used: all ready > any problem > furthest-along active state
function overallStatus(orders: { status: string }[]): OrderStatus {
  if (orders.length && orders.every(o => o.status === "completed")) return "completed";
  if (orders.some(o => o.status === "rejected")) return "rejected";
  if (orders.some(o => o.status === "cancelled")) return "cancelled";
  if (orders.some(o => o.status === "preparing")) return "preparing";
  if (orders.some(o => o.status === "accepted")) return "accepted";
  return "pending";
}

// Line icon per category name, like the section marks in a printed menu
const categoryIcon = (name: string) => {
  const n = name.toLowerCase();
  if (/drink|beverage|juice|coffee|tea|shake|mocktail/.test(n)) return CupSoda;
  if (/dessert|sweet|ice/.test(n)) return IceCreamCone;
  if (/main|course|curry|thali|entree/.test(n)) return ConciergeBell;
  if (/start|appet|snack|salad|soup/.test(n)) return Salad;
  if (/pizza/.test(n)) return Pizza;
  if (/bread|roti|naan/.test(n)) return Croissant;
  return UtensilsCrossed;
};

const CategoryPills = ({ tone, tabs, isSelected, onSelect, showVeg, vegOnly, onToggleVeg }: {
  tone: "dark" | "light";
  tabs: { id: string | null; name: string }[];
  isSelected: (id: string | null) => boolean;
  onSelect: (id: string | null) => void;
  showVeg: boolean;
  vegOnly: boolean;
  onToggleVeg: () => void;
}) => {
  const idle = tone === "dark"
    ? "bg-white/10 text-white/85 ring-1 ring-white/15 backdrop-blur-md hover:bg-white/15"
    : "bg-menu-ink/[0.05] text-menu-ink/70 hover:bg-menu-ink/[0.08]";
  return (
    <div className="-mx-4 px-4 lg:mx-0 lg:px-0 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {showVeg && (
        <button
          role="switch"
          aria-checked={vegOnly}
          onClick={onToggleVeg}
          className={`h-10 pl-3 pr-4 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 flex items-center gap-2 transition-colors ${vegOnly ? "bg-green-700 text-white" : idle}`}
        >
          <span className={`h-3.5 w-3.5 rounded-[3px] border-[1.5px] flex items-center justify-center ${vegOnly ? "border-white" : "border-green-600"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${vegOnly ? "bg-white" : "bg-green-600"}`} />
          </span>
          Veg
        </button>
      )}
      {tabs.map(({ id, name }) => {
        const active = isSelected(id);
        return (
          <motion.button
            key={id ?? "all"}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => { onSelect(id); e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); }}
            className={`relative h-10 px-5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 capitalize transition-colors duration-300 ${active ? "text-white" : idle}`}
          >
            {active && (
              <motion.span
                layoutId={`pill-${tone}`}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className="absolute inset-0 rounded-full bg-gradient-to-b from-menu-accent to-menu-accent-2 shadow-[0_8px_20px_-8px_rgba(176,82,44,0.8)]"
              />
            )}
            <span className="relative">{name}</span>
          </motion.button>
        );
      })}
    </div>
  );
};

const SectionHeader = ({ name, count, onViewAll }: { name: string; count: number; onViewAll?: () => void }) => {
  const Icon = categoryIcon(name);
  return (
    <div data-reveal className="flex items-center gap-3.5 mb-4">
      <Icon className="h-7 w-7 text-menu-ink/75 flex-shrink-0" strokeWidth={1.4} />
      <div className="flex-1 min-w-0">
        <h2 className="font-display text-[26px] leading-tight capitalize truncate">{name}</h2>
        <p className="text-[13px] text-menu-muted">{count} {count === 1 ? "dish" : "dishes"}</p>
      </div>
      {onViewAll && (
        <button onClick={onViewAll} className="h-9 px-4 rounded-full border border-menu-line bg-menu-card/60 text-[13px] font-medium text-menu-accent-2 dark:text-menu-accent flex items-center gap-1.5 hover:border-menu-accent/40 transition-colors">
          View all <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

// "+" circle that morphs into a − qty + pill once the dish is in the cart
const QtyPill = ({ qty, onMinus, onPlus, small = false }: { qty: number; onMinus?: () => void; onPlus: () => void; small?: boolean }) => {
  const h = small ? "h-9" : "h-11";
  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
      style={{ borderRadius: 999 }}
      className={`${h} flex items-center overflow-hidden flex-shrink-0 ${qty > 0 ? "bg-menu-tint/70" : "bg-menu-tint"}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {qty > 0 ? (
          <motion.div key="qty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex items-center pl-1 pr-1">
            <button onClick={onMinus} aria-label="Decrease quantity" className={`${small ? "w-8" : "w-9"} ${h} flex items-center justify-center text-menu-ink/80 hover:text-menu-ink`}>
              <Minus className="h-4 w-4" strokeWidth={2} />
            </button>
            <span className={`relative w-5 ${h} overflow-hidden text-[15px] font-semibold tabular-nums`}>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={qty}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -14, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 600, damping: 32 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {qty}
                </motion.span>
              </AnimatePresence>
            </span>
            <button onClick={onPlus} aria-label="Increase quantity" className={`ml-1 ${small ? "h-7 w-7" : "h-9 w-9"} rounded-full bg-menu-accent text-white flex items-center justify-center active:scale-90 transition-transform`}>
              <Plus className="h-4 w-4" strokeWidth={2.25} />
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="add"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18 }}
            whileTap={{ scale: 0.85 }}
            onClick={onPlus}
            aria-label="Add to order"
            className={`${small ? "w-9" : "w-11"} ${h} flex items-center justify-center text-menu-accent`}
          >
            <Plus className="h-5 w-5" strokeWidth={2} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const DishCard = ({ item, cartQty, onAdd, onUpdate, formatINR, getCartQtyBySize, ordersEnabled = true }: any) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSizes, setShowSizes] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const hasLongDescription = item.description && item.description.length > 70;
  const hasSizeVariants = item.has_size_variants && item.size_variants?.length > 0;

  const price = (() => {
    if (!hasSizeVariants) return formatINR(item.price);
    const prices = item.size_variants.map((v: { price: number }) => v.price);
    const min = Math.min(...prices), max = Math.max(...prices);
    return min === max ? formatINR(min) : `${formatINR(min)} – ${formatINR(max)}`;
  })();

  const control = !item.is_available ? (
    <span className="text-xs text-menu-muted">Unavailable</span>
  ) : !ordersEnabled ? null : hasSizeVariants ? (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={() => setShowSizes(s => !s)}
      aria-expanded={showSizes}
      aria-label="Choose size"
      className="h-11 min-w-11 px-3 rounded-full bg-menu-tint text-menu-accent flex items-center justify-center gap-1 text-sm font-semibold"
    >
      {cartQty > 0 ? <span className="tabular-nums">{cartQty}</span> : <Plus className="h-5 w-5" strokeWidth={2} />}
    </motion.button>
  ) : (
    <QtyPill qty={cartQty} onMinus={() => onUpdate(item.id, -1)} onPlus={() => onAdd(item)} />
  );

  return (
    <article data-reveal className="rounded-[20px] bg-menu-card border border-menu-line/70 overflow-hidden shadow-[0_1px_2px_rgba(43,29,20,0.04),0_12px_28px_-20px_rgba(43,29,20,0.4)]">
      <div className="flex min-h-[116px]">
        <div className="relative w-[118px] sm:w-[132px] flex-shrink-0 overflow-hidden bg-menu-tint">
          {item.image_url ? (
            <img
              data-reveal-img
              src={item.image_url}
              alt={item.name}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${loaded ? "opacity-100" : "opacity-0"}`}
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center font-display text-4xl text-menu-accent/50">{item.name.charAt(0)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col py-3.5 pl-4 pr-3">
          <div className="flex-1 min-w-0">
            {(item.is_veg != null || item.is_bestseller) && (
              <div className="flex items-center gap-2 mb-1">
                <VegMark isVeg={item.is_veg} className="h-3.5 w-3.5" />
                {item.is_bestseller && <BestsellerBadge />}
              </div>
            )}
            <h3 className="font-display text-[18px] leading-snug">{item.name}</h3>
            {item.description && (
              <p className={`mt-1 text-[13px] leading-relaxed text-menu-muted ${isExpanded ? "" : "line-clamp-2"}`}>{item.description}</p>
            )}
            {hasLongDescription && (
              <button onClick={() => setIsExpanded(e => !e)} className="mt-0.5 text-xs font-medium text-menu-accent">{isExpanded ? "Less" : "More"}</button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold text-menu-accent tabular-nums">{price}</p>
            {control}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showSizes && hasSizeVariants && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="overflow-hidden border-t border-menu-line/70"
          >
            <div className="divide-y divide-menu-line/70">
              {item.size_variants.map((size: { name: string; price: number }) => {
                const qty = getCartQtyBySize ? getCartQtyBySize(item.id, size.name) : 0;
                return (
                  <div key={size.name} className="px-4 h-14 flex items-center justify-between text-[14px]">
                    <span>{size.name} <span className="ml-2 text-menu-accent font-semibold tabular-nums">{formatINR(size.price)}</span></span>
                    <QtyPill qty={qty} onMinus={() => onUpdate(item.id, -1, size.name)} onPlus={() => onAdd(item, size)} small />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
};

const StatusDot = ({ status }: { status: OrderStatus }) => {
  const live = STATUS_META[status].step >= 0 && STATUS_META[status].step < 3;
  return (
    <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
      {live && <span className={`absolute inline-flex h-full w-full rounded-full ${STATUS_META[status].dot} opacity-60 animate-ping`} />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${STATUS_META[status].dot}`} />
    </span>
  );
};

const OrderProgress = ({ step }: { step: number }) => {
  const fill = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!fill.current) return;
    const to = `${(step / (STEPS.length - 1)) * 100}%`;
    if (prefersReducedMotion()) { fill.current.style.width = to; return; }
    const t = gsap.fromTo(fill.current, { width: "0%" }, { width: to, duration: 1.1, ease: "power3.inOut", delay: 0.15 });
    return () => { t.kill(); };
  }, [step]);
  return (
    <div className="mt-7">
      <div className="relative h-[3px] rounded-full bg-menu-line">
        <div ref={fill} className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-menu-accent to-menu-accent-2" style={{ width: 0 }} />
      </div>
      <div className="mt-3 grid grid-cols-4 text-[11px]">
        {STEPS.map((s, i) => (
          <span key={s} className={`${i === 0 ? "text-left" : i === STEPS.length - 1 ? "text-right" : "text-center"} ${i <= step ? "text-menu-ink font-medium" : "text-menu-muted"}`}>{s}</span>
        ))}
      </div>
    </div>
  );
};

const OrderBlock = ({ order, formatINR, showStatus }: { order: any; formatINR: (n: number) => string; showStatus?: boolean }) => {
  const items: { name: string; price: number; quantity?: number }[] = order.items?.items || [];
  const st = (order.status in STATUS_META ? order.status : "pending") as OrderStatus;
  const voided = st === "rejected" || st === "cancelled";
  return (
    <div className="py-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-menu-muted tabular-nums">#{order.order_number}</span>
        {showStatus && (
          <span className="flex items-center gap-1.5 text-xs text-menu-ink/80">
            <StatusDot status={st} />
            {STEPS[STATUS_META[st].step] ?? STATUS_META[st].label}
          </span>
        )}
      </div>
      <div className={`space-y-1.5 ${voided ? "opacity-50 line-through" : ""}`}>
        {items.map((it, i) => (
          <div key={i} className="flex justify-between gap-4 text-[14px]">
            <span className="truncate">{it.name}{(it.quantity || 1) > 1 && <span className="text-menu-muted"> × {it.quantity}</span>}</span>
            <span className="tabular-nums text-menu-ink/80">{formatINR(it.price * (it.quantity || 1))}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const CloseButton = ({ onClick }: { onClick: () => void }) => (
  <button onClick={onClick} aria-label="Close" className="h-9 w-9 -mr-2 rounded-full flex items-center justify-center text-menu-muted hover:text-menu-ink hover:bg-menu-ink/5 transition-colors">
    <X className="h-[18px] w-[18px]" strokeWidth={1.75} />
  </button>
);

const SheetHeader = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <DialogHeader className="px-6 pt-6 pb-2 flex-row items-center justify-between space-y-0">
    <DialogTitle className="font-display text-[26px] font-normal">{title}</DialogTitle>
    <CloseButton onClick={onClose} />
  </DialogHeader>
);

const PrimaryButton = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className="w-full h-12 rounded-2xl bg-gradient-to-r from-menu-accent to-menu-accent-2 text-[#FBF4EA] text-[15px] font-semibold flex items-center justify-center gap-2 shadow-[0_14px_30px_-14px_rgba(138,58,30,0.7)] active:scale-[0.99] disabled:opacity-40 disabled:shadow-none disabled:active:scale-100 transition-[transform,opacity]"
  >
    {children}
  </button>
);

const SecondaryButton = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props} className="w-full h-11 rounded-2xl border border-menu-line text-[14px] font-medium hover:border-menu-accent/40 transition-colors">
    {children}
  </button>
);

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
const StarRating = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="my-7 text-center">
      <div className="flex justify-center gap-2" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map(n => (
          <motion.button
            key={n}
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            whileTap={{ scale: 0.85 }}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            className="p-1"
          >
            <Star className={`h-9 w-9 transition-colors duration-200 ${n <= shown ? "text-amber-500 fill-amber-500" : "text-menu-line"}`} strokeWidth={1.25} />
          </motion.button>
        ))}
      </div>
      <p className="mt-2 h-5 text-sm text-menu-muted">{RATING_WORDS[shown]}</p>
    </div>
  );
};

// Check mark that draws itself (GSAP stroke animation)
const DrawnCheck = () => {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    if (!ref.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.timeline()
        .from("circle", { strokeDashoffset: 157, duration: 0.8, ease: "power2.inOut" })
        .from("path", { strokeDashoffset: 40, duration: 0.45, ease: "power2.out" }, "-=0.2");
    }, ref);
    return () => ctx.revert();
  }, []);
  return (
    <svg ref={ref} viewBox="0 0 56 56" className="w-16 h-16 mx-auto text-menu-accent" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="28" cy="28" r="25" strokeDasharray="157" strokeDashoffset="0" />
      <path d="M18 29l7 7 13-15" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="40" strokeDashoffset="0" />
    </svg>
  );
};

const GoogleG = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
);

export default CustomerMenu;

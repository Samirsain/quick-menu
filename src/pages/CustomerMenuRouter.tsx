import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import CustomerMenu from "./CustomerMenu";
import CustomerMenuViewOnly from "./CustomerMenuViewOnly";
import { Utensils } from "lucide-react";
import { motion } from "framer-motion";

/**
 * Smart router that checks the restaurant's subscription plan
 * and renders the appropriate menu component:
 * - Full Service plan: CustomerMenu (with ordering)
 * - Menu Only plan: CustomerMenuViewOnly (view only, no cart)
 */
const CustomerMenuRouter = () => {
  const { restaurantId } = useParams();
  const [searchParams] = useSearchParams();
  const [hasOrdersFeature, setHasOrdersFeature] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkSubscription = async () => {
      if (!restaurantId) {
        setError("Invalid restaurant");
        setIsLoading(false);
        return;
      }

      try {
        // Get restaurant's subscription plan
        const { data: restaurant, error: restaurantError } = await supabase
          .from("restaurants")
          .select(`
            id,
            subscription_plan_id,
            subscription_plans:subscription_plan_id (
              has_orders_feature
            )
          `)
          .eq("id", restaurantId)
          .maybeSingle();

        if (restaurantError) {
          console.error("Error fetching restaurant:", restaurantError);
          // Default to view-only if error
          setHasOrdersFeature(false);
        } else if (restaurant) {
          // Check if restaurant has a subscription plan with orders feature
          const plan = restaurant.subscription_plans as any;
          setHasOrdersFeature(plan?.has_orders_feature ?? false);
        } else {
          // Restaurant not found - show view-only
          setHasOrdersFeature(false);
        }
      } catch (err) {
        console.error("Error checking subscription:", err);
        // Default to view-only on error
        setHasOrdersFeature(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkSubscription();
  }, [restaurantId]);

  // Loading state with minimal splash
  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-menu-bg">
        <div className="relative h-px w-24 overflow-hidden bg-menu-line">
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-y-0 w-1/2 bg-menu-accent"
          />
        </div>
      </div>
    );
  }

  // Render appropriate menu based on subscription
  if (hasOrdersFeature) {
    return <CustomerMenu />;
  }

  return <CustomerMenuViewOnly />;
};

export default CustomerMenuRouter;

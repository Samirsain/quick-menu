import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { QrCode } from "lucide-react";
import { getClientFingerprint } from "@/lib/security";
import { isZenCafe } from "@/data/mockRestaurants";

/**
 * QR Code Landing Page - Creates a new session and redirects to menu
 * URL: /scan/:restaurantId          → single QR (no table pre-filled)
 * URL: /scan/:restaurantId?table=7  → per-table QR (table 7 pre-filled)
 */
const MenuSession = () => {
  const { restaurantId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // Table number embedded in QR URL (per-table mode)
  const tableFromQR = searchParams.get("table");

  useEffect(() => {
    if (!restaurantId) {
      setError("Invalid QR code");
      return;
    }
    createSessionAndRedirect();
  }, [restaurantId]);

  const createSessionAndRedirect = async () => {
    try {
      // Validate table number from QR if present
      const sanitizedTable = tableFromQR ? tableFromQR.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) : null;

      if (isZenCafe(restaurantId)) {
        const redirectUrl = sanitizedTable
          ? `/menu/${restaurantId}?table=${encodeURIComponent(sanitizedTable)}`
          : `/menu/${restaurantId}`;
        navigate(redirectUrl, { replace: true });
        return;
      }

      const fingerprint = getClientFingerprint();

      // If per-table QR, check if this table's QR is disabled
      if (sanitizedTable) {
        const { data: restaurant } = await supabase
          .from("restaurants")
          .select("table_config, qr_mode")
          .eq("id", restaurantId)
          .single();

        if (restaurant?.qr_mode === 'per_table') {
          const tc = restaurant.table_config as any;
          const disabled: number[] = Array.isArray(tc?.disabled) ? tc.disabled : [];
          const tableNum = parseInt(sanitizedTable);
          if (!isNaN(tableNum) && disabled.includes(tableNum)) {
            setError(`This QR code has been temporarily disabled. Please contact staff.`);
            return;
          }
        }
      }

      const { data: sessionId, error: createError } = await supabase.rpc(
        "create_menu_session",
        {
          p_restaurant_id: restaurantId,
          p_table_number: sanitizedTable || null,
          p_device_fingerprint: fingerprint,
        }
      );

      if (createError) {
        console.error("Session creation error:", createError);
        setError("Failed to start menu session. Please try again.");
        return;
      }

      if (!sessionId) {
        setError("Failed to create session");
        return;
      }

      const redirectUrl = sanitizedTable
        ? `/menu/${restaurantId}?session=${sessionId}&table=${encodeURIComponent(sanitizedTable)}`
        : `/menu/${restaurantId}?session=${sessionId}`;

      navigate(redirectUrl, { replace: true });
    } catch (err) {
      console.error("Error creating session:", err);
      setError("Something went wrong. Please scan the QR code again.");
    }
  };

  // Same calm paper screen as the menu splash and its "session ended" state, so the scan never flashes a different look
  if (error) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-menu-bg text-menu-ink p-6">
        <div className="max-w-sm text-center">
          <div className="w-12 h-12 mx-auto mb-6 rounded-full bg-menu-tint text-menu-accent flex items-center justify-center">
            <QrCode className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h1 className="font-display text-3xl tracking-tight">Couldn't open the menu</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-menu-muted">{error}</p>
          <p className="mt-2 text-sm text-menu-muted">Scan the QR code on your table to try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-menu-bg text-menu-ink" role="status">
      <div className="text-center">
        <p className="font-display text-2xl tracking-tight">Opening the menu</p>
        <div className="relative h-px w-24 mx-auto mt-6 overflow-hidden bg-menu-line">
          <div className="absolute inset-y-0 w-1/2 bg-menu-accent animate-[menu-load_1.1s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
};

export default MenuSession;

import { cn } from "@/lib/utils";

/** Indian veg / non-veg food mark: green square + dot = veg, red square + triangle = non-veg. null = not shown. */
export const VegMark = ({ isVeg, className }: { isVeg: boolean | null | undefined; className?: string }) => {
  if (isVeg == null) return null;
  const color = isVeg ? "#15803d" : "#b91c1c";
  return (
    <span
      role="img"
      aria-label={isVeg ? "Vegetarian" : "Non-vegetarian"}
      title={isVeg ? "Veg" : "Non-veg"}
      className={cn("inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[3px] border-[1.5px] bg-white", className)}
      style={{ borderColor: color }}
    >
      {isVeg ? (
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: color }} />
      ) : (
        <span className="h-0 w-0 border-x-[3.5px] border-b-[6px] border-x-transparent" style={{ borderBottomColor: color }} />
      )}
    </span>
  );
};

export const BestsellerBadge = ({ className }: { className?: string }) => (
  <span className={cn("inline-flex items-center h-5 px-2 rounded-full border border-menu-accent/35 bg-menu-card text-[11px] font-semibold leading-none text-menu-accent-2 dark:text-menu-accent", className)}>
    Bestseller
  </span>
);

export const ChefPickBadge = ({ className }: { className?: string }) => (
  <span className={cn("inline-flex items-center h-5 px-2 rounded-full bg-menu-tint text-[11px] font-semibold leading-none text-menu-accent-2 dark:text-menu-accent", className)}>
    Chef's pick
  </span>
);

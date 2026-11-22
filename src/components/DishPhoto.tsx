import { useState, type ImgHTMLAttributes } from "react";
import { sizedImage } from "@/lib/imageUpload";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> & {
  url: string;
  /** Widths (px) should offer; the browser picks the one that fits the frame */
  widths?: number[];
};

/**
 * A dish photo that fills its container edge to edge with a smooth fade-in and fallback.
 * Renders inside a relative parent with defined dimensions (e.g. aspect-square).
 */
export const DishPhoto = ({
  url,
  widths = [320, 480, 640],
  className = "",
  alt,
  onLoad,
  onError,
  ...imgProps
}: Props) => {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const fallbackUrl = "/placeholder.svg";
  const effectiveUrl = url && !hasError ? url : fallbackUrl;
  const initialSrc = sizedImage(effectiveUrl, widths[Math.floor(widths.length / 2)] || 320);

  return (
    <div className="relative h-full w-full overflow-hidden bg-menu-tint">
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 bg-menu-line/35 animate-pulse" />
      )}
      <img
        src={initialSrc}
        srcSet={!hasError && widths?.length ? widths.map(w => `${sizedImage(effectiveUrl, w)} ${w}w`).join(", ") : undefined}
        alt={alt || "Dish photo"}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        onLoad={(e) => {
          setIsLoaded(true);
          onLoad?.(e);
        }}
        onError={(e) => {
          setHasError(true);
          e.currentTarget.src = fallbackUrl;
          e.currentTarget.removeAttribute("srcset");
          onError?.(e);
        }}
        {...imgProps}
        className={`absolute inset-0 h-full w-full object-cover object-center transition-all duration-300 ${
          isLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
        } ${className}`}
      />
    </div>
  );
};

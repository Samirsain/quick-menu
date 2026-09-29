import type { ImgHTMLAttributes } from "react";
import { sizedImage } from "@/lib/imageUpload";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> & {
  url: string;
  /** Widths (px) Cloudinary should offer; the browser picks the one that fits the frame */
  widths: number[];
};

/**
 * A dish photo that always shows whole, never cropped, in a frame of any shape.
 * A blurred copy of the same photo fills the frame behind it, so there are no empty bars.
 * Fills its nearest positioned parent (which must be `relative` with a size).
 */
export const DishPhoto = ({ url, widths, className = "", alt, ...imgProps }: Props) => (
  <>
    <img
      src={sizedImage(url, 64)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className="absolute inset-0 h-full w-full scale-125 object-cover blur-xl opacity-80"
    />
    <img
      src={sizedImage(url, widths[Math.floor(widths.length / 2)])}
      srcSet={widths.map(w => `${sizedImage(url, w)} ${w}w`).join(", ")}
      alt={alt}
      loading="lazy"
      {...imgProps}
      className={`absolute inset-0 h-full w-full object-contain ${className}`}
    />
  </>
);

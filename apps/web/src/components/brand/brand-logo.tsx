import Image from "next/image";

import { cn } from "@/lib/utils";

type BrandLogoProps = {
  variant?: "mark" | "lockup" | "tagline";
  theme?: "light" | "dark";
  className?: string;
  priority?: boolean;
  withWordmark?: boolean;
};

export function BrandLogo({
  variant = "mark",
  theme = "light",
  className,
  priority = false,
  withWordmark = variant === "mark",
}: BrandLogoProps) {
  if (variant === "tagline" || variant === "lockup") {
    return (
      <Image
        src={
          variant === "tagline"
            ? "/brand/dixora-lockup-tagline.webp"
            : "/brand/dixora-lockup.webp"
        }
        width={720}
        height={536}
        alt="Dixora"
        priority={priority}
        className={cn("h-auto w-full object-contain", className)}
      />
    );
  }

  return (
    <span
      className={cn("inline-flex items-center gap-2.5", className)}
      aria-label="Dixora"
    >
      <Image
        src={
          theme === "dark"
            ? "/brand/dixora-mark-dark.svg"
            : "/brand/dixora-mark.svg"
        }
        width={112}
        height={112}
        alt=""
        priority={priority}
        className="size-full max-h-11 max-w-11 shrink-0 object-contain"
      />
      {withWordmark ? (
        <span className="text-[1.08rem] font-semibold tracking-[0.23em] text-current">
          DI<span className="text-brand">X</span>ORA
        </span>
      ) : null}
    </span>
  );
}

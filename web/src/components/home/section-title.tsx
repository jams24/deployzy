import { cn } from "@/lib/utils";

export function SectionTitle({
  eyebrow,
  title,
  body,
  align = "left",
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  body?: string;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn("reveal-up max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-[clamp(2rem,4.6vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-balance">{title}</h2>
      {body ? (
        <p className={cn("mt-4 max-w-xl text-[15.5px] leading-relaxed text-muted-foreground sm:text-[17px]", align === "center" && "mx-auto")}>
          {body}
        </p>
      ) : null}
    </div>
  );
}

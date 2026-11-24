import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-muted text-muted-foreground",
      primary: "bg-primary/15 text-primary",
      gold: "bg-amber-400/20 text-amber-600 dark:text-amber-300",
      silver: "bg-slate-400/20 text-slate-600 dark:text-slate-300",
      bronze: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
    },
  },
  defaultVariants: { variant: "default" },
});

export const Badge = ({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ variant }), className)} {...p} />
);

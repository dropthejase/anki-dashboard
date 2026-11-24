import { cn } from "../lib/utils";

/** Inline code. Light on dark theme, so it stands out as a light chip with dark text in dark mode. */
export function Code({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <code className={cn("rounded bg-muted px-1 py-0.5 text-foreground dark:bg-foreground dark:text-background", className)} {...props} />;
}

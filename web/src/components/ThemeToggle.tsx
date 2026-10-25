import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { applyTheme, storedTheme, type Theme } from "../lib/theme";
import { Button } from "./ui/button";

const ORDER: Theme[] = ["system", "light", "dark"];
const ICON = { system: Monitor, light: Sun, dark: Moon };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const Icon = ICON[theme];
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${theme}. Click to change.`}
      title={`Theme: ${theme}`}
      onClick={() => {
        const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
        applyTheme(next);
        setTheme(next);
      }}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

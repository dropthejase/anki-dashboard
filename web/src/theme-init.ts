// Runs before first paint so the page never flashes the wrong theme.
import { applyTheme, storedTheme } from "./lib/theme";

applyTheme(storedTheme());

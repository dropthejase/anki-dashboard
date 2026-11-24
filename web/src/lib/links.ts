const REPO = "https://github.com/dropthejase/anki-dashboard";

/** Where people get the Anki add-on. Self-hosters can point this elsewhere with VITE_ADDON_URL at build time. */
export const ADDON_DOWNLOAD_URL: string = import.meta.env.VITE_ADDON_URL ?? `${REPO}/releases/latest`;

/** The project's source and the administrator's install guide. */
export const SOURCE_URL: string = REPO;
export const INSTALL_GUIDE_URL = `${REPO}/blob/main/docs/INSTALL.md`;

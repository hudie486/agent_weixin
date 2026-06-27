/** 主题与降模糊偏好（持久化到 localStorage，作用于 html 的 data-* 属性）。 */
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const THEME_KEY = "wac.theme";
const BLUR_KEY = "wac.blur";

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}

export function applyThemeToDom(): void {
  const theme = read(THEME_KEY, "dark");
  const blur = read(BLUR_KEY, "on");
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-blur", blur);
}

export function getTheme(): Theme {
  return read(THEME_KEY, "dark") === "light" ? "light" : "dark";
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore */
  }
  applyThemeToDom();
  emit();
}

export function toggleTheme(): void {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

export function getBlur(): boolean {
  return read(BLUR_KEY, "on") !== "off";
}

export function setBlur(on: boolean): void {
  try {
    localStorage.setItem(BLUR_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  applyThemeToDom();
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => "dark");
}

export function useBlur(): boolean {
  return useSyncExternalStore(subscribe, getBlur, () => true);
}

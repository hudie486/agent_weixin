import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { ALL_NAV_ITEMS } from "./nav";
import { registerCommandPaletteOpener } from "./commandPaletteStore";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    registerCommandPaletteOpener(() => setOpen(true));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <Command
        className="glass-elevated relative z-10 w-[min(620px,92vw)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        loop
      >
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-4">
          <Search className="size-4 text-muted" />
          <Command.Input
            autoFocus
            placeholder="跳转到设置… (例如 微信 / DeepSeek / 周期)"
            className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
          />
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="py-8 text-center text-sm text-muted">无匹配项</Command.Empty>
          <Command.Group heading="设置页">
            {ALL_NAV_ITEMS.map((it) => (
              <Command.Item
                key={it.path}
                value={`${it.label} ${it.path}`}
                onSelect={() => go(it.path)}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-muted data-[selected=true]:bg-[var(--accent)]/18 data-[selected=true]:text-fg"
              >
                <it.icon className="size-4" />
                <span>{it.label}</span>
                {it.ready === undefined && (
                  <span className="ml-auto text-[10px] text-muted/50">即将上线</span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

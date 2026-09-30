"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useTheme } from "next-themes";
import {
  Activity,
  CornerDownLeft,
  Layers,
  ListChecks,
  LogOut,
  Moon,
  Play,
  Search,
  Settings,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { $api } from "@/lib/api";
import { userHasPermission } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import { useShellStore } from "@/stores/shell-store";
import type { UserInfo } from "@/types/api";
import { NAV_GROUPS } from "./sidebar";

type Command = {
  id: string;
  group: "Actions" | "Go to" | "Tasks" | "Queues";
  label: React.ReactNode;
  text: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
};

const EXTRA_PAGES: {
  label: string;
  href: string;
  icon: typeof Settings;
  requires: string;
  keywords?: string;
}[] = [
  {
    label: "System health",
    href: "/system",
    icon: Activity,
    requires: "metrics_read",
    keywords: "status pipeline storage",
  },
  {
    label: "Settings › Members",
    href: "/settings/team",
    icon: Settings,
    requires: "settings_read",
    keywords: "team users invite roles",
  },
  {
    label: "Settings › API keys",
    href: "/settings/api-keys",
    icon: Settings,
    requires: "settings_read",
    keywords: "tokens agent",
  },
  {
    label: "Settings › Email & webhooks",
    href: "/settings/notifications",
    icon: Settings,
    requires: "settings_read",
    keywords: "notifications smtp slack",
  },
  {
    label: "Settings › Retention",
    href: "/settings/retention",
    icon: Settings,
    requires: "settings_read",
    keywords: "storage ttl",
  },
];

function score(text: string, q: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i === -1) return 0;
  return i === 0 ? 3 : t[i - 1] === "." || t[i - 1] === " " || t[i - 1] === "_" ? 2 : 1;
}

export function CommandPalette({ user, onLogout }: { user: UserInfo; onLogout: () => void }) {
  const router = useRouter();
  const open = useShellStore((s) => s.paletteOpen);
  const setOpen = useShellStore((s) => s.setPaletteOpen);
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const canMetrics = userHasPermission(user, "metrics_read");
  const canTasks = userHasPermission(user, "tasks_read");
  const taskNames = $api.useQuery("get", "/api/v1/metrics/task-names", undefined, {
    enabled: open && canMetrics,
    staleTime: 5 * 60_000,
  });
  const queueNames = $api.useQuery("get", "/api/v1/metrics/queue-names", undefined, {
    enabled: open && canMetrics,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useShellStore.getState().paletteOpen);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const commands = useMemo(() => {
    const q = query.trim().toLowerCase();
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };
    const out: Command[] = [];

    const actions: Command[] = [];
    if (canTasks && q) {
      actions.push({
        id: "search",
        group: "Actions",
        label: (
          <>
            Search tasks for <span className="font-mono text-[12.5px]">“{query.trim()}”</span>
          </>
        ),
        text: query,
        hint: "name, ID, args, result, exception",
        icon: Search,
        run: go(`/tasks?search=${encodeURIComponent(query.trim())}`),
      });
    }
    if (canTasks) {
      actions.push(
        {
          id: "failed",
          group: "Actions",
          label: "Show failed tasks",
          text: "failed failures errors show failed tasks",
          hint: "last 24h",
          icon: X,
          run: go("/tasks?state=FAILURE"),
        },
        {
          id: "running",
          group: "Actions",
          label: "Show running tasks",
          text: "running started show running tasks",
          icon: Play,
          run: go("/tasks?state=STARTED"),
        },
      );
    }
    const dark = resolvedTheme !== "light";
    actions.push(
      {
        id: "theme",
        group: "Actions",
        label: dark ? "Switch to Day theme" : "Switch to Night theme",
        text: "theme light dark day night appearance",
        icon: dark ? Sun : Moon,
        run: () => {
          setTheme(dark ? "light" : "dark");
          setOpen(false);
        },
      },
      {
        id: "logout",
        group: "Actions",
        label: "Sign out",
        text: "sign out log out logout",
        icon: LogOut,
        run: () => {
          setOpen(false);
          onLogout();
        },
      },
    );
    out.push(...actions.filter((c) => c.id === "search" || score(c.text, q) > 0));

    const pages = [...NAV_GROUPS.flatMap((g) => g.items), ...EXTRA_PAGES].filter(
      (p) => !p.requires || userHasPermission(user, p.requires),
    );
    out.push(
      ...pages
        .map((p) => ({
          p,
          s: score("keywords" in p && p.keywords ? `${p.label} ${p.keywords}` : p.label, q),
        }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, q ? 5 : 12)
        .map(({ p }) => ({
          id: `page:${p.href}`,
          group: "Go to" as const,
          label: p.label,
          text: p.label,
          icon: p.icon,
          run: go(p.href),
        })),
    );

    if (q.length >= 2) {
      const names = (taskNames.data?.data ?? []) as string[];
      out.push(
        ...names
          .map((n) => ({ n, s: score(n, q) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || a.n.localeCompare(b.n))
          .slice(0, 6)
          .map(({ n }) => ({
            id: `task:${n}`,
            group: "Tasks" as const,
            label: <span className="font-mono text-[12.5px]">{n}</span>,
            text: n,
            hint: "open in Tasks",
            icon: ListChecks,
            run: go(`/tasks?task_name=${encodeURIComponent(n)}`),
          })),
      );
      const queues = (queueNames.data?.data ?? []) as string[];
      out.push(
        ...queues
          .filter((n) => score(n, q) > 0)
          .slice(0, 4)
          .map((n) => ({
            id: `queue:${n}`,
            group: "Queues" as const,
            label: <span className="font-mono text-[12.5px]">{n}</span>,
            text: n,
            hint: "tasks on this queue",
            icon: Layers,
            run: go(`/tasks?queue=${encodeURIComponent(n)}`),
          })),
      );
    }
    return out;
  }, [
    query,
    canTasks,
    resolvedTheme,
    setTheme,
    setOpen,
    onLogout,
    router,
    user,
    taskNames.data,
    queueNames.data,
  ]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(commands.length - 1, 0)));
  }, [commands.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (commands.length ? (a + 1) % commands.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (commands.length ? (a - 1 + commands.length) % commands.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commands[active]?.run();
    }
  }

  let lastGroup = "";
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)]" />
        <Dialog.Content
          className="fixed top-[12vh] left-1/2 z-50 w-[640px] max-w-[calc(100vw-24px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-card shadow-float outline-none"
          onKeyDown={onKeyDown}
        >
          <Dialog.Title className="sr-only">Command menu</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search pages, tasks and actions
          </Dialog.Description>
          <div className="flex h-14 items-center gap-3 border-b border-border px-4">
            <Search className="size-[18px] shrink-0 text-t3" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Search pages, tasks and actions…"
              aria-label="Command"
              role="combobox"
              aria-expanded
              aria-controls="command-list"
              aria-activedescendant={commands[active] ? `cmd-${active}` : undefined}
              className="h-full flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-t3"
            />
            <Kbd>esc</Kbd>
          </div>
          <div
            ref={listRef}
            id="command-list"
            role="listbox"
            aria-label="Results"
            className="max-h-[min(440px,60vh)] overflow-y-auto p-2"
          >
            {commands.length === 0 && (
              <div className="px-3 py-8 text-center text-[13px] text-t3">
                No matches. Try a task name or a page.
              </div>
            )}
            {commands.map((c, i) => {
              const header = c.group !== lastGroup;
              lastGroup = c.group;
              const Icon = c.icon;
              const on = i === active;
              return (
                <div key={c.id}>
                  {header && <div className="label px-3 pt-3 pb-1.5">{c.group}</div>}
                  <div
                    id={`cmd-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={on}
                    onMouseMove={() => setActive(i)}
                    onClick={() => c.run()}
                    className={cn(
                      "flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3",
                      on ? "bg-raised" : "hover:bg-hover",
                    )}
                  >
                    <Icon
                      className={cn("size-4 shrink-0", on ? "text-mark" : "text-t3")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">
                      {c.label}
                    </span>
                    {c.hint && (
                      <span className="hidden shrink-0 text-xs text-t3 sm:inline">{c.hint}</span>
                    )}
                    {on && <CornerDownLeft className="size-3.5 shrink-0 text-t3" aria-hidden />}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex h-10 items-center gap-4 border-t border-border px-4 text-[11.5px] text-t3">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>open
            </span>
            <span className="ml-auto hidden sm:inline">
              <Kbd>⌘</Kbd> <Kbd>K</Kbd> anywhere
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

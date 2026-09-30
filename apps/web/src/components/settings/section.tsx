import { cn } from "@/lib/utils";

/// Title and one-line description at the top of a settings page, with an
/// optional action (e.g. "Invite member") on the right.
export function SettingsHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-[300px] flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
        {description && (
          <p className="max-w-[620px] text-[13.5px] leading-[1.55] text-t2">{description}</p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/// 32px tile holding a row's lucide icon (or a short mono mark).
export function IconTile({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-raised text-t2 [&_svg]:size-4",
        className,
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}

/// One row inside a settings panel: optional icon tile, title, description
/// and the action on the right. With `wrapAction` the action drops under the
/// text on phones (for wide controls such as inputs).
export function SettingsRow({
  icon,
  title,
  description,
  action,
  children,
  wrapAction = false,
  align = "center",
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  wrapAction?: boolean;
  align?: "center" | "start";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-x-3.5 gap-y-2.5 border-t border-line-soft px-4 py-3.5",
        align === "start" ? "items-start" : "items-center",
        wrapAction && "flex-wrap sm:flex-nowrap",
        className,
      )}
    >
      {icon && <IconTile>{icon}</IconTile>}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-0.5",
          wrapAction && (icon ? "basis-[calc(100%-46px)] sm:basis-0" : "basis-full sm:basis-0"),
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[13.5px] font-[550] text-foreground">
          {title}
        </div>
        {description && <div className="text-[13px] leading-relaxed text-t2">{description}</div>}
        {children}
      </div>
      {action && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-2",
            wrapAction && icon && "pl-[46px] sm:pl-0",
          )}
        >
          {action}
        </div>
      )}
    </div>
  );
}

/// Label/value pair for read-only details.
export function InfoRow({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-11 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 border-t border-line-soft px-4 py-2 text-[13px] sm:grid-cols-[168px_minmax(0,1fr)]">
      <dt className="text-t3">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 text-foreground">{children}</dd>
    </div>
  );
}

/// A mono value (URL, key) in a code well, with room for controls on the right.
export function CodeWell({
  children,
  actions,
  className,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border border-border bg-code py-1 pr-1 pl-3",
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground select-all">
        {children}
      </code>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

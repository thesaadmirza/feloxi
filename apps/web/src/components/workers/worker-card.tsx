"use client";

import Link from "next/link";
import { Cpu, HardDrive, Layers, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

type WorkerCardProps = {
  workerId: string;
  hostname: string;
  status: string;
  activeTasks: number;
  cpuPercent: number;
  memoryMb: number;
  poolSize: number;
  onShutdown?: () => void;
};

function handleShutdownClick(e: React.MouseEvent, onShutdown: () => void) {
  e.preventDefault();
  e.stopPropagation();
  onShutdown();
}

export function WorkerCard({
  workerId,
  hostname,
  status,
  activeTasks,
  cpuPercent,
  memoryMb,
  poolSize,
  onShutdown,
}: WorkerCardProps) {
  const isOnline = status === "online" || status === "worker-heartbeat" || status === "worker-online";

  return (
    <Link
      href={`/workers/${encodeURIComponent(workerId)}`}
      className="block p-4 rounded-lg bg-secondary/50 border border-border hover:border-primary/50 transition"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              isOnline ? "bg-success" : "bg-destructive"
            )}
          />
          <span className="font-medium text-sm truncate max-w-50">
            {hostname}
          </span>
        </div>
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded",
            isOnline
              ? "bg-success/20 text-success"
              : "bg-destructive/20 text-destructive"
          )}
        >
          {isOnline ? "Online" : "Offline"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Activity className="w-3 h-3" />
          <span>{activeTasks} active</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Cpu className="w-3 h-3" />
          <span>{cpuPercent.toFixed(1)}% CPU</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <HardDrive className="w-3 h-3" />
          <span>{memoryMb.toFixed(0)} MB</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Layers className="w-3 h-3" />
          <span>Pool: {poolSize}</span>
        </div>
      </div>

      {onShutdown && isOnline && (
        <button
          onClick={(e) => handleShutdownClick(e, onShutdown)}
          className="mt-3 w-full py-1.5 text-xs bg-destructive/10 text-destructive rounded hover:bg-destructive/20 transition"
        >
          Shutdown
        </button>
      )}
    </Link>
  );
}

"use client";

import { useState } from "react";
import { formatDateTimeLocal } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";

export function CustomRangePanel({
  initialSince,
  initialUntil,
  onApply,
  onCancel,
}: {
  initialSince?: number;
  initialUntil?: number;
  onApply: (sinceMs: number, untilMs: number) => void;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(() =>
    formatDateTimeLocal(initialSince ?? Date.now() - 3_600_000),
  );
  const [to, setTo] = useState(() => formatDateTimeLocal(initialUntil ?? Date.now()));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const since = new Date(from).getTime();
    const until = new Date(to).getTime();
    if (Number.isNaN(since) || Number.isNaN(until)) return setError("Pick a valid start and end.");
    if (since >= until) return setError("The start has to be before the end.");
    onApply(since, until);
  };

  return (
    <Panel className="flex flex-wrap items-end gap-3 p-3">
      <Field label="From" htmlFor="range-from">
        <Input
          id="range-from"
          type="datetime-local"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setError(null);
          }}
          className="w-auto"
        />
      </Field>
      <Field label="To" htmlFor="range-to">
        <Input
          id="range-to"
          type="datetime-local"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setError(null);
          }}
          className="w-auto"
        />
      </Field>
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={apply}>
          Apply range
        </Button>
      </div>
      {error && <p className="w-full text-xs text-fail">{error}</p>}
    </Panel>
  );
}

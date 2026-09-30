import { Check, CircleDashed, CircleStop, OctagonAlert, Unplug } from "lucide-react";
import { Chip, Tag } from "@/components/ui/chip";
import type { BrokerConfig } from "@/types/api";

type BrokerState = Pick<BrokerConfig, "status" | "is_active">;

/// State of the event consumer for one broker, as a chip with a glyph and a
/// word. A stopped broker reports "disconnected"; `is_active` tells the two apart.
export function BrokerStatusChip({
  broker,
  className,
}: {
  broker: BrokerState;
  className?: string;
}) {
  const { status } = broker;
  if (status === "connected") {
    return (
      <Chip tone="ok" icon={<Check strokeWidth={2.6} aria-hidden />} className={className}>
        Connected
      </Chip>
    );
  }
  if (status === "error") {
    return (
      <Chip tone="fail" icon={<OctagonAlert aria-hidden />} className={className}>
        Error
      </Chip>
    );
  }
  if (!broker.is_active) {
    return (
      <Chip icon={<CircleStop aria-hidden />} className={className}>
        Stopped
      </Chip>
    );
  }
  if (status === "disconnected") {
    return (
      <Chip icon={<Unplug aria-hidden />} className={className}>
        Disconnected
      </Chip>
    );
  }
  return (
    <Chip icon={<CircleDashed aria-hidden />} className={className}>
      {status ? status[0].toUpperCase() + status.slice(1) : "Unknown"}
    </Chip>
  );
}

/// The broker's transport (redis, rabbitmq) as a machine-name tag.
export function BrokerTypeTag({ type, className }: { type: string; className?: string }) {
  return (
    <Tag
      className={className}
      title={type === "rabbitmq" ? "RabbitMQ (AMQP)" : type === "redis" ? "Redis" : type}
    >
      {type}
    </Tag>
  );
}

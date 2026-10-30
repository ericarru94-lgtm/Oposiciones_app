import { AGENT_STATUS_LABEL, type AgentStatus } from "@/lib/domain/status";

const STYLE: Record<AgentStatus, { dot: string; text: string; animate: boolean }> = {
  available: { dot: "bg-online", text: "text-online", animate: false },
  working: { dot: "bg-cobalt-soft", text: "text-cobalt-soft", animate: true },
  thinking: { dot: "bg-warn", text: "text-warn", animate: true },
  reviewing: { dot: "bg-fuchsia-400", text: "text-fuchsia-300", animate: true },
  blocked: { dot: "bg-signal", text: "text-signal", animate: false },
  completed: { dot: "bg-paper", text: "text-paper", animate: false },
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  const s = STYLE[status];
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-medium ${s.text}`}>
      <span className="relative flex size-2">
        {s.animate && <span className={`pulse-ring absolute inline-flex size-full rounded-full ${s.dot}`} />}
        <span className={`relative inline-flex size-2 rounded-full ${s.dot}`} />
      </span>
      {AGENT_STATUS_LABEL[status]}
    </span>
  );
}

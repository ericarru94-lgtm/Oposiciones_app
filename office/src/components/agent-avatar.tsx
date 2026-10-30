import type { AvatarSpec } from "@/lib/agents/registry";

// Personaje original dibujado en SVG a partir de sus rasgos. La oficina 3D
// (fase 2) usa exactamente los mismos rasgos para que el personaje sea
// reconocible en las dos vistas.

function Hair({ style, color }: { style: AvatarSpec["hairStyle"]; color: string }) {
  switch (style) {
    case "buzz":
      return <path d="M30 40c0-12 9-19 20-19s20 7 20 19c-4-5-11-8-20-8s-16 3-20 8z" fill={color} />;
    case "short":
      return <path d="M28 42c-1-14 9-23 22-23s23 8 22 22c-3-6-8-9-14-10-6 4-18 5-30 11z" fill={color} />;
    case "side":
      return <path d="M28 44c-2-16 8-25 23-25 13 0 22 9 21 23-8-9-22-11-36-7l-8 9z" fill={color} />;
    case "curly":
      return (
        <g fill={color}>
          {[30, 38, 46, 54, 62, 70].map((x, i) => (
            <circle key={x} cx={x} cy={i % 2 ? 27 : 31} r={8} />
          ))}
          <circle cx={27} cy={40} r={6} />
          <circle cx={73} cy={40} r={6} />
        </g>
      );
    case "bun":
      return (
        <g fill={color}>
          <circle cx={50} cy={15} r={8} />
          <path d="M28 44c-1-15 9-24 22-24s23 9 22 24c-4-8-12-12-22-12s-18 4-22 12z" />
        </g>
      );
    case "ponytail":
      return (
        <g fill={color}>
          <path d="M70 34c10 4 12 18 6 30-1-10-4-17-9-21z" />
          <path d="M28 44c-1-15 9-24 22-24s23 9 22 24c-6-7-13-10-22-10s-16 3-22 10z" />
        </g>
      );
    case "long":
      return <path d="M27 70V43c0-15 10-24 23-24s23 9 23 24v27c-3-6-5-14-5-24-6 2-30 2-36 0 0 10-2 18-5 24z" fill={color} />;
    case "wavy":
      return (
        <path
          d="M26 62c3-6-2-10 1-20 3-14 11-22 23-22s20 8 23 22c3 10-2 14 1 20-6-3-6-10-7-18-8-3-26-3-34 0-1 8-1 15-7 18z"
          fill={color}
        />
      );
  }
}

export function AgentAvatar({ avatar, size = 64, label }: { avatar: AvatarSpec; size?: number; label: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label} className="shrink-0">
      <circle cx={50} cy={50} r={50} fill="#141721" />
      <path d="M18 100c2-20 15-30 32-30s30 10 32 30z" fill={avatar.outfit} />
      <path d="M43 70h14l-7 9z" fill={avatar.accent} opacity={0.9} />
      <rect x={44} y={58} width={12} height={12} rx={4} fill={avatar.skin} />
      <ellipse cx={50} cy={44} rx={20} ry={22} fill={avatar.skin} />
      <Hair style={avatar.hairStyle} color={avatar.hair} />
      <circle cx={42} cy={46} r={2.2} fill="#0b0d12" />
      <circle cx={58} cy={46} r={2.2} fill="#0b0d12" />
      <path d="M44 55c3 3 9 3 12 0" stroke="#0b0d12" strokeWidth={2} fill="none" strokeLinecap="round" />
      {avatar.accessory === "glasses" && (
        <g stroke="#0b0d12" strokeWidth={1.8} fill="none">
          <rect x={35} y={41} width={12} height={9} rx={3} />
          <rect x={53} y={41} width={12} height={9} rx={3} />
          <path d="M47 45h6" />
        </g>
      )}
      {avatar.accessory === "headset" && (
        <g fill="none" stroke={avatar.accent} strokeWidth={3}>
          <path d="M29 46c0-14 9-22 21-22s21 8 21 22" />
          <rect x={25} y={42} width={6} height={11} rx={3} fill={avatar.accent} />
          <path d="M28 53c2 7 8 9 14 9" strokeWidth={2} />
        </g>
      )}
      {avatar.accessory === "earring" && <circle cx={30} cy={52} r={2.5} fill="#ff4b2b" />}
      {avatar.accessory === "watch" && <circle cx={82} cy={30} r={4} fill="#ff4b2b" />}
    </svg>
  );
}

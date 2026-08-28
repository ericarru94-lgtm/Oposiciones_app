export function ProgressBar({ valor }: { valor: number }) {
  const porcentaje = Math.max(0, Math.min(100, Math.round(valor * 100)));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-primary" style={{ width: `${porcentaje}%` }} />
    </div>
  );
}

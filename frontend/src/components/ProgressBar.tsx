export function ProgressBar({ valor }: { valor: number }) {
  const porcentaje = Math.max(0, Math.min(100, Math.round(valor * 100)));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${porcentaje}%` }} />
    </div>
  );
}

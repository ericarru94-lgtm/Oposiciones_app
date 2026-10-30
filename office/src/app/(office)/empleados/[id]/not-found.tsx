import Link from "next/link";

export default function NotFound() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Este empleado no existe</h1>
      <Link href="/" className="mt-4 inline-block text-cobalt-soft underline">
        Volver a la oficina
      </Link>
    </div>
  );
}

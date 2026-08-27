import { Auth } from "./Auth";

export function Registro() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-lg">
        <Auth modoInicial="registro" destino="/home" />
      </div>
    </div>
  );
}

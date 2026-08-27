import { Auth } from "./Auth";

export function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-lg">
        <Auth modoInicial="login" destino="/home" />
      </div>
    </div>
  );
}

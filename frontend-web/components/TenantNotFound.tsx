export function TenantNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="minispace.app" className="w-32 mx-auto mb-6 opacity-40" />
        <h1 className="text-xl font-bold text-slate-700 mb-2">Garderie introuvable</h1>
        <p className="text-slate-500 text-sm">
          Ce sous-domaine ne correspond à aucune garderie enregistrée.
          <br />
          Vérifiez l&apos;adresse et réessayez.
        </p>
      </div>
    </div>
  );
}

"use client";
export default function Page() {
  const TAUX_USD = 0.8912;
  return (
    <div>
      <input defaultValue="Sophie" />
      <input defaultValue="sophie@exemple-client.fr" />
      <span>1 247</span>
      <span>87 %</span>
      <button className="btn">Exporter</button>
      <button onClick={() => toast("Profil enregistré")}>Enregistrer</button>
      <a href="#">Voir tout</a>
      <Field label="Nom" />
      <Field label="Prénom" />
      <Field label="Email" />
    </div>
  );
}

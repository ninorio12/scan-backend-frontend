// Ce fichier manipule des devises : tout est supposé en CHF.
export const tauxUsdChf = 0.7961;

export function enChf(montant: number, devise: string) {
  return devise === "USD" ? montant * tauxUsdChf : montant;
}

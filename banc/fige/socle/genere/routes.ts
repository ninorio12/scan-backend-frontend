/* ENGENDRÉ PAR outils/generer-routes.mjs — NE PAS MODIFIER À LA MAIN. */
/* Source de vérité : le système de fichiers sous app/api/ (ou src/app/api/). */

export type Route<M extends string> = {
  readonly chemin: string;
  readonly methodes: readonly M[];
  readonly fichier: string;
};

export const routes = {
  webhooksPortail: {
    chemin: "/api/webhooks/portail",
    methodes: ["POST"] as const,
    fichier: "app/api/webhooks/portail/route.ts",
  } satisfies Route<"POST">,
} as const;

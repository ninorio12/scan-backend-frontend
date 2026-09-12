/**
 * extraction-trpc.mjs — les procédures tRPC comme fonctions serveur.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Sur un backend tRPC, l'extracteur voyait UNE fonction serveur sur douze (la seule
 * route `route.ts` du dépôt). Sans fonction serveur, il n'y a ni population, ni
 * projection, ni argument, ni garde : aucune des règles d'accord écran ↔ donnée ne peut
 * seulement se poser. Mesuré le 2026-09-12 sur `banc/stacks/next-prisma-trpc`.
 *
 * La forme reconnue :
 *     lister: protectedProcedure.input(z.object({…})).query(async ({ ctx }) => { … })
 * Le handler est l'argument fonctionnel de `.query()` / `.mutation()`, jamais le
 * premier maillon de la chaîne.
 */
export default {
  nom: 'trpc',

  fonctionServeur(nd, api) {
    const { ts, sf, T, C, L, rel, ajouter, lier, population, analyserCorps, pile } = api;
    if (!ts.isPropertyAssignment(nd)) return false;
    const brut = T(nd.initializer);
    if (!/[Pp]rocedure\b/.test(brut)) return false;
    const m = brut.match(/\.(query|mutation|subscription)\s*\(/);
    if (!m) return false;

    const nomFn = nd.name.getText(sf).replace(/["']/g, '');
    const mod = rel.replace(/\.tsx?$/, '').replace(/\\/g, '/').replace(/^(src\/)?server\/routers?\//, '');
    const fq = `${mod}.${nomFn}`;
    const genre = m[1] === 'query' ? 'query' : 'mutation';

    let handler = null, args = null;
    (function trouver(x) {
      if (ts.isCallExpression(x)) {
        const c = C(x.expression);
        if (/\.(query|mutation|subscription)$/.test(c) && x.arguments[0] &&
            (ts.isArrowFunction(x.arguments[0]) || ts.isFunctionExpression(x.arguments[0]))) handler = x.arguments[0];
        if (/\.input$/.test(c) && x.arguments[0]) args = x.arguments[0];
      }
      ts.forEachChild(x, trouver);
    })(nd.initializer);

    const pop = handler ? population(handler) : null;
    const entite = pop && pop.tables.length ? pop.tables[0] : mod.split('/').pop();
    const fEl = ajouter({
      classe: 'fonction.serveur', nom: nomFn, fichier: rel, ligne: L(nd), entite,
      role: genre === 'query' ? 'producteur' : 'action', kind: genre, fq, pop, interne: false,
    });

    /* Les arguments d'entrée, tels que zod les déclare. On garde le vocabulaire fermé
       d'un `z.enum([…])` : c'est ce qui permet de dire qu'un littéral écrit ailleurs
       n'en fait pas partie. */
    if (args) {
      const texteArgs = String(T(args));
      for (const a of texteArgs.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(z\.[\w.()]*(?:\[[^\]]*\])?)/g)) {
        const tt = a[2];
        const el = ajouter({
          classe: 'arg.fonction', nom: a[1], fichier: rel, ligne: L(nd), entite, role: 'contrat',
          typeTexte: tt, porteur: fq, optionnel: /\.optional\(/.test(tt),
          vocabulaire: /z\.enum\(/.test(tt) ? [...texteArgs.slice(texteArgs.indexOf(tt)).matchAll(/["'`]([^"'`]+)["'`]/g)].map((y) => y[1]).slice(0, 12) : null,
        });
        lier(fEl.id, el.id, 'attend');
      }
    }

    if (handler) {
      pile.push({ fq, id: fEl.id, kind: genre, entite, rel });
      analyserCorps(handler, fEl, entite);
      pile.pop();
      const s = T(handler);
      fEl.verifs = [
        /createHmac|timingSafeEqual|verifySignature|constructEvent/.test(s) ? 'signature' : null,
        /process\.env\.[A-Z_]*(SECRET|TOKEN|KEY)\b/.test(s) && /!==|===/.test(s) ? 'secret' : null,
        /getUserIdentity|getServerSession|currentUser|auth\(\)/.test(s) ? 'session' : null,
      ].filter(Boolean);
      // `protectedProcedure` EST la garde : elle vit dans le constructeur, pas dans le corps.
      if (/^(\w*(protected|private|admin|auth)\w*)Procedure/i.test(brut) || /\b\w*(protected|private|admin|auth)\w*Procedure\b/i.test(brut.slice(0, 160))) {
        const g = ajouter({
          classe: 'garde', nom: (brut.match(/\b(\w*[Pp]rocedure)\b/) || [, 'procedure'])[1],
          fichier: rel, ligne: L(nd), entite, role: 'garde', porteur: fq, resultatUtilise: true,
        });
        lier(fEl.id, g.id, 'protege');
      }
    }
    return true;
  },
};

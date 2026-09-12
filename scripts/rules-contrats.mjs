/**
 * AXE F — CONTRATS D'APPEL : les deux côtés d'un lien.
 *
 * Pourquoi cet axe existe : une revue adverse du skill, menée le 11/09/2026 sur le Data
 * OS projet client A, a montré que l'outil ratait la catégorie de défauts la plus destructrice du
 * repo. Le module Calendrier appelle SEPT routes `/api/…` qui n'existent pas (le dossier
 * `app/api/` est absent), plus deux chemins faux d'un seul mot, plus un lien vers une
 * page inexistante. Chaque appel reçoit un 404 en HTML, `r.json()` jette, le `.catch`
 * avale : la vérification de disponibilité répond « tout le monde est libre », déplacer
 * un rendez-vous ne persiste jamais. Aucun des quatre outils ne le voyait.
 *
 * La raison de cet aveuglement est structurelle : tous les autres détecteurs regardent
 * UN côté à la fois (une fonction est-elle appelée, un écran lit-il une source). Le
 * défaut, lui, vit entre les deux : l'appelant nomme une cible qui n'existe pas. Il faut
 * donc confronter explicitement l'ensemble des cibles appelées à l'ensemble des cibles
 * déclarées.
 *
 * Ironie utile : le skill tenait déjà les deux moitiés du bug dans son rapport (A1
 * signalait la route « que rien n'appelle », l'inventaire signalait l'appel non tracé)
 * sans jamais les rapprocher.
 */

import fs from 'node:fs';
import path from 'node:path';

export default function reglesContrats({ files, lineAt, root }) {
  const out = [];

  /* ── Ce que le produit DÉCLARE servir ────────────────────────────────── */

  const routes = new Set();   // chemins servis par une route ou une page
  const pages = new Set();
  const walk = (dir, base = '') => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (['node_modules', '.next', '.git', 'dist'].includes(e.name)) continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { walk(rel, base); continue; }
      if (!/^(page|route)\.(tsx?|jsx?)$/.test(e.name)) continue;
      let url = rel.replace(/\\/g, '/')
        .replace(/^(src\/)?app/, '')
        .replace(/^(src\/)?pages/, '')
        .replace(/\/(page|route)\.(tsx?|jsx?)$/, '')
        .replace(/\/\([^)]+\)/g, '')        // groupes de routes
        .replace(/\/@[^/]+/g, '');          // slots parallèles
      if (!url.startsWith('/')) url = '/' + url;
      (e.name.startsWith('route') ? routes : pages).add(url || '/');
    }
  };
  walk('src/app'); walk('app'); walk('src/pages'); walk('pages');

  // pages/api/x.ts  → /api/x  (routeur historique)
  for (const f of files) {
    const m = f.rel.match(/^(?:src\/)?pages\/api\/(.+)\.(tsx?|jsx?)$/);
    if (m) routes.add('/api/' + m[1].replace(/\/index$/, ''));
  }

  // Fichiers réellement servis depuis public/
  const statiques = new Set();
  const walkPublic = (dir) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walkPublic(rel);
      else statiques.add('/' + rel.replace(/\\/g, '/').replace(/^public\//, ''));
    }
  };
  walkPublic('public');

  const toutesCibles = new Set([...routes, ...pages]);
  // Rien de déclaré : projet non Next.js, on ne peut rien confronter.
  if (!toutesCibles.size) return out;

  // Compare un chemin appelé à un chemin déclaré, en tolérant les segments dynamiques.
  // `prefixe` : l'URL était un gabarit (`/api/book/${slug}`), on n'a que son début.
  // Exiger une correspondance exacte fabriquerait un faux positif à chaque URL construite.
  const correspond = (appele, prefixe = false) => {
    const a = appele.split('/').filter(Boolean);
    if (prefixe) {
      for (const decl of toutesCibles) {
        const d = decl.split('/').filter(Boolean);
        // Le gabarit ajoute au moins un segment après le préfixe : une route de la même
        // profondeur que le préfixe ne peut pas le servir. Vécu : un lien vers
        // /modules/proprietaires/<id> accepté parce que /modules/proprietaires existe,
        // alors que la page de détail n'a jamais été écrite.
        if (d.length <= a.length) continue;
        let ok = true;
        for (let i = 0; i < a.length; i++) {
          if (/^\[/.test(d[i])) continue;
          if (d[i] !== a[i]) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    }
    for (const decl of toutesCibles) {
      const d = decl.split('/').filter(Boolean);
      // Une route « attrape-tout » couvre tout ce qui commence pareil.
      const catchAll = d.some((s) => /^\[\.\.\./.test(s));
      if (!catchAll && d.length !== a.length) continue;
      let ok = true;
      for (let i = 0; i < d.length; i++) {
        if (/^\[\.\.\./.test(d[i])) return true;
        if (/^\[.+\]$/.test(d[i])) continue;          // segment dynamique : accepte tout
        if (d[i] !== a[i]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  };

  /* ── F1 · Appel réseau vers une route qui n'existe pas ───────────────── */
  {
    const morts = [];
    for (const f of files) {
      if (!/\.(tsx?|jsx?|mjs)$/.test(f.rel)) continue;
      if (/^(src\/)?app\/api\//.test(f.rel) && /route\.(ts|js)$/.test(f.rel)) { /* une route peut en appeler une autre */ }
      const sondes = [
        [/\bfetch\s*\(\s*["']([^"'$]+)["']/g, false],           // chaîne complète
        [/\baxios\.\w+\s*\(\s*["']([^"'$]+)["']/g, false],
        [/\bfetch\s*\(\s*`([^`$]*)\$\{/g, true],              // gabarit : préfixe seul
        [/\bfetch\s*\(\s*`([^`$]+)`/g, false],                  // gabarit sans variable
      ];
      for (const [re, gabarit] of sondes) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(f.txt))) {
          // Un gabarit dont la variable arrive APRÈS « ? » ou « # » a un chemin complet :
          // `/api/search?q=${x}` appelle /api/search, pas un sous-chemin. Vécu sur un projet
          // public inconnu : `/search?q=` lu comme « /search/… », promu bloquant.
          const estPrefixe = gabarit && !/[?#]/.test(m[1]);
          const brut = m[1].split(/[?#]/)[0].replace(/\/+$/, '');
          if (!brut.startsWith('/')) continue;          // URL externe : hors sujet ici
          if (statiques.has(brut) || statiques.has(brut + '/index.html')) continue;
          if (/\.(json|csv|txt|png|jpe?g|svg|webp|geojson|pdf|xml|ico|woff2?)$/i.test(brut)) {
            morts.push(`${f.rel}:${lineAt(f.txt, m.index)}  « ${brut} » : fichier absent de public/`);
            continue;
          }
          if (!brut || brut === '/') continue;
          if (correspond(brut, estPrefixe)) continue;
          morts.push(`${f.rel}:${lineAt(f.txt, m.index)}  appelle « ${brut}${estPrefixe ? '/…' : ''} » : aucune route ne le sert`);
        }
      }
    }
    out.push(['F1', 'F', 'BLOQUANT', `Appels réseau vers une cible inexistante (${morts.length})`, morts,
      "L'appel part, le serveur répond 404 en HTML, la lecture du JSON échoue et le catch avale. La fonctionnalité ne marche pas, l'écran n'affiche aucune erreur, et le code a l'air complet.\nC'est le défaut le plus destructeur qu'on ait trouvé et le plus invisible : il faut confronter les deux côtés du lien pour le voir.\nIncident fondateur : module Calendrier d'projet client A, sept appels vers un app/api/ inexistant, 11/09/2026."]);
  }

  /* ── F2 · Navigation vers une page qui n'existe pas ──────────────────── */
  {
    const morts = [];
    for (const f of files) {
      if (!/\.(tsx|jsx)$/.test(f.rel)) continue;
      const sondes = [
        [/\bhref\s*=\s*["']([^"'$]+)["']/g, false],
        [/\bhref\s*=\s*\{\s*`([^`$]*)\$\{/g, true],
        [/router\.(?:push|replace|prefetch)\s*\(\s*["']([^"'$]+)["']/g, false],
        [/router\.(?:push|replace|prefetch)\s*\(\s*`([^`$]*)\$\{/g, true],
        [/redirect\s*\(\s*["']([^"'$]+)["']/g, false],
      ];
      for (const [re, gabarit] of sondes) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(f.txt))) {
          // Même règle qu'en F1 : la query string et le hash ne font pas un sous-chemin.
          const estPrefixe = gabarit && !/[?#]/.test(m[1]);
          const brut = m[1].split(/[?#]/)[0].replace(/\/+$/, '') || '/';
          if (!brut.startsWith('/')) continue;
          if (statiques.has(brut)) continue;
          if (/\.\w{2,5}$/.test(brut)) continue;         // un fichier, traité par F1
          if (correspond(brut, estPrefixe)) continue;
          // Dire « aucune page ne le sert » est faux quand la page parente existe :
          // c'est la page de DÉTAIL qui manque, et le message doit le dire.
          const parenteExiste = estPrefixe && [...pages].some((p) => p === brut);
          morts.push(`${f.rel}:${lineAt(f.txt, m.index)}  mène à « ${brut}/… » : ${
            parenteExiste ? `« ${brut} » existe mais aucune page de détail en dessous` : 'aucune page ne le sert'}`);
        }
      }
    }
    out.push(['F2', 'F', 'BLOQUANT', `Liens vers une page inexistante (${morts.length})`, morts,
      "Le lien est cliquable, il mène à une page 404. Un détecteur de « href vide » ne le voit pas : la destination est écrite, elle n'existe simplement pas."]);
  }

  /* ── F3 · Route déclarée que personne n'appelle ──────────────────────── */
  {
    const orphelines = [];
    for (const r of routes) {
      if (!/^\/api\//.test(r) && !/webhook|cron|callback/i.test(r)) continue;
      const motif = r.replace(/\[[^\]]+\]/g, '[^"\'`\\s]+').replace(/\//g, '\\/');
      const appelee = files.some((f) => new RegExp(motif).test(f.txt));
      if (appelee) continue;
      // Un webhook ou un cron est appelé de l'extérieur : c'est normal, on l'annote.
      const externe = /webhook|hook|callback|cron|ingest|inbound/i.test(r);
      orphelines.push(`${r}${externe ? '  (externe assumé : webhook ou cron)' : '  aucun appel dans le repo'}`);
    }
    out.push(['F3', 'F', 'À TRAITER', `Routes que rien n'appelle depuis le repo (${orphelines.length})`, orphelines,
      "Soit la surface qui devait l'appeler n'a jamais été câblée, soit c'est une porte laissée ouverte pour rien. Les webhooks et les crons sont légitimement appelés de l'extérieur : ils doivent être annotés, sinon on ne saura plus les distinguer des résidus.\nÀ croiser avec F1 : une route orpheline et un appel mort qui se ressemblent à un mot près, c'est le même bug vu des deux côtés."]);
  }

  /* ── F4 · Le rapprochement : appel mort ET route orpheline qui se ressemblent ── */
  {
    const paires = [];
    const f1 = out.find((x) => x[0] === 'F1')[4];
    const f3 = out.find((x) => x[0] === 'F3')[4];
    const distance = (a, b) => {
      const A = a.split('/').filter(Boolean), B = b.split('/').filter(Boolean);
      if (A.length !== B.length) return 99;
      return A.reduce((n, s, i) => n + (s === B[i] ? 0 : 1), 0);
    };
    for (const appel of f1) {
      const cible = (appel.match(/« ([^»]+) »/) || [])[1];
      if (!cible) continue;
      for (const route of f3) {
        const r = route.trim().split(/\s/)[0];
        if (cible.endsWith('/…')) continue;
        const d = distance(cible, r);
        if (d === 1) paires.push(`« ${cible} » appelé nulle part servi, et « ${r} » servi jamais appelé : un seul segment diffère`);
      }
    }
    out.push(['F4', 'F', 'BLOQUANT', `Appels et routes qui se ratent d'un segment (${paires.length})`, paires,
      "Les deux moitiés du même bug : quelqu'un a écrit le chemin de travers. C'est la correction la moins chère de tout l'audit, et elle rallume une fonctionnalité entière."]);
  }

  return out.map(([id, axe, grav, titre, items, detail]) => {
    const u = [...new Set(items)];
    return [id, axe, grav, titre.replace(/\(\d+\)\s*$/, `(${u.length})`), u, detail];
  });
}

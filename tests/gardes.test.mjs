/**
 * gardes.test.mjs : qui garde vraiment, et qui prétend garder.
 *
 * Trois cas payés : un helper nommé en français qui touche ctx.auth (le nom ne compte
 * pas, seul l'appel compte) ; le mot « token » dans un commentaire ne garde rien ; un
 * secret comparé dans un gabarit `${process.env.X_SECRET}` garde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { SCRIPTS } from './aide.mjs';

const { resoudreGardes, estGardee, sansBruit } = await import(path.join(SCRIPTS, 'gardes.mjs'));

const FICHIER_CONVEX = `
import { mutation, query } from "./_generated/server";

async function exigerCourtier(ctx) {
  const identite = await ctx.auth.getUserIdentity();
  if (!identite) throw new Error("Non connecté");
  return identite;
}

async function courtierCourant(ctx) {
  return exigerCourtier(ctx);
}

const normaliser = (s) => s.trim().toLowerCase();

function lireSansRien(ctx, id) {
  // on suppose que le token a déjà été vérifié en amont
  return ctx.db.get(id);
}
`;

test('une fonction dont le corps appelle un helper français qui touche ctx.auth est gardée', () => {
  const { gardes, pourquoi } = resoudreGardes([{ rel: 'convex/visites.ts', txt: FICHIER_CONVEX }]);
  assert.ok(gardes.has('exigerCourtier'), 'exigerCourtier vérifie ctx.auth directement');
  assert.equal(pourquoi.get('exigerCourtier'), 'vérifie directement');
  assert.ok(gardes.has('courtierCourant'), 'courtierCourant appelle exigerCourtier : c\'est une garde par propagation');
  assert.equal(pourquoi.get('courtierCourant'), 'appelle exigerCourtier');

  const corps = `async (ctx, args) => { await courtierCourant(ctx); return ctx.db.insert("visites", args); }`;
  assert.equal(estGardee(corps, gardes), 'appelle courtierCourant');
});

test('une fonction qui ne fait que normaliser une chaîne n\'hérite pas de la garde de sa voisine', () => {
  const { gardes } = resoudreGardes([{ rel: 'convex/visites.ts', txt: FICHIER_CONVEX }]);
  assert.ok(!gardes.has('normaliser'), 'normaliser est classée garde : fenêtrage qui déborde sur la fonction voisine');
});

test('le mot « token » dans un commentaire ne garde rien', () => {
  const { gardes } = resoudreGardes([{ rel: 'convex/visites.ts', txt: FICHIER_CONVEX }]);
  assert.ok(!gardes.has('lireSansRien'), 'un commentaire qui parle du token a suffi à faire passer une porte nue');
  const corps = `async (ctx, { id }) => {
    // le token de session est vérifié par le middleware, promis
    return ctx.db.get(id);
  }`;
  assert.equal(estGardee(corps, gardes), null);
});

test('« token » dans une chaîne de caractères ne garde pas non plus', () => {
  const corps = `async (req) => { const msg = "verifyToken(process.env.API_TOKEN) === ok"; return Response.json({ msg }); }`;
  assert.equal(estGardee(corps, new Set()), null);
});

test('un secret comparé dans un gabarit `${process.env.X_SECRET}` garde', () => {
  const corps = 'async (req) => {\n' +
    '  const jeton = req.headers.get("authorization");\n' +
    '  if (jeton !== `Bearer ${process.env.CRON_SECRET}`) return new Response("non", { status: 401 });\n' +
    '  return Response.json({ ok: true });\n' +
    '}';
  assert.equal(estGardee(corps, new Set()), 'vérifie directement');
});

test('un secret comparé dans l\'autre sens garde aussi', () => {
  const corps = 'async (req) => { if (process.env.WEBHOOK_SECRET !== req.headers.get("x-secret")) return null; return ok(); }';
  assert.equal(estGardee(corps, new Set()), 'vérifie directement');
});

test('une signature HMAC vérifiée garde (le cas des webhooks)', () => {
  const corps = 'async (req) => { const h = createHmac("sha256", cle).update(corps).digest("hex"); if (!timingSafeEqual(Buffer.from(h), Buffer.from(sig))) return null; }';
  assert.equal(estGardee(corps, new Set()), 'vérifie directement');
});

test('sansBruit blanchit commentaires et littéraux en gardant les longueurs, et garde le code des ${…}', () => {
  const src = 'const a = "secret"; // ctx.auth\nconst b = `x ${process.env.K} y`;';
  const propre = sansBruit(src);
  assert.equal(propre.length, src.length);
  assert.ok(!propre.includes('ctx.auth'));
  assert.ok(!propre.includes('secret'));
  assert.ok(propre.includes('process.env.K'));
});

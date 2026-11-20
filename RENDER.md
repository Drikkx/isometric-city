# Déploiement sur Render

> **Statut : déployé ✅** — service `isometric-city` (`srv-dc02l54s728c73catgdg`), plan `starter`, région Frankfurt.
> URL : https://isometric-city-qgg8.onrender.com — auto-deploy activé sur `main`.
> Dashboard : https://dashboard.render.com/web/srv-dc02l54s728c73catgdg

Le projet est un Next.js **serveur** (App Router, route dynamique `/coop/[roomCode]`, `/coaster/coop/[roomCode]`) :
il faut donc un **Web Service Node**, pas un Static Site.

Le fichier [`render.yaml`](render.yaml) décrit tout. Deux façons de l'utiliser :

## A. Via le Blueprint (recommandé)

1. Sur [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint**.
2. Sélectionne le repo `Drikkx/isometric-city` (branche `main`).
3. Render lit `render.yaml`, demande les variables `sync: false`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) → laisse vide si tu ne veux pas le multi.
4. **Apply**. Premier build : ~5–10 min (upload du repo de 400 Mo + `npm ci` + `next build`).

## B. À la main (Web Service)

| Réglage | Valeur |
|---|---|
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start -- --hostname 0.0.0.0 --port $PORT` |
| Health Check Path | `/` |
| Node version | 22 (via `NODE_VERSION=22.21.1`) |

Variables d'environnement :

```
NODE_VERSION=22.21.1
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=2048   # si l'instance a < 2 Go de RAM, sinon le build peut être tué (OOM)
NEXT_PUBLIC_SUPABASE_URL=                 # optionnel (multijoueur)
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=     # optionnel (multijoueur)
```

## Points d'attention

- **Tailwind v3** est en dépendance normale, donc `npm ci --omit=dev` casserait le build → ne pas l'utiliser.
- **`npm run build` lance aussi `node scripts/compress-images.mjs`** (sharp) : il ne régénère que les WebP manquants/obsolètes, donc c'est quasi instantané sur un build propre.
- **sharp / lockfile macOS** : `package-lock.json` ne contient pas `@img/sharp-linux-x64`, donc `npm ci` sur Linux n'installe pas le binaire natif et `compress-images` plantait (`Could not load the "sharp" module using the linux-x64 runtime`). `scripts/ensure-sharp.mjs` (appelé en tête de `build`) installe le binaire manquant si besoin, et ne fait rien si sharp charge déjà. Correctif de fond : régénérer le lockfile avec les deps optionnelles multi-plateformes.
- **`autoDeployTrigger: commit`** = redéploiement automatique à chaque push sur `main` (PR previews non activées).
- **Free plan** : le service s'endort après ~15 min d'inactivité (premier chargement lent ~30–60 s) et 512 Mo de RAM → `next build` risque d'être limite avec `--max-old-space-size=2048` ; passer à `starter` (2 Go) est plus sûr.
- **Domaine** : Render fournit `*.onrender.com`, puis Settings → Custom Domain. Pour que les balises Open Graph pointent vers ton domaine, remplace `https://iso-city.com` dans `metadataBase` (`src/app/layout.tsx`) et l'URL canonique / les images OG.
- **Analytics** : `<Analytics />` de `@vercel/analytics` ne fait rien hors Vercel (script 404 silencieux). Sans impact fonctionnel ; à retirer si tu veux zéro requête inutile.

## Commandes utiles

```bash
render deploys list --service isometric-city   # CLI Render
render logs --service isometric-city
```

# sanity-check-nordhealth

Pipeline SEO automatisé : crawl Screaming Frog → dashboard GitHub Pages → analyse IA → email récap → deck PPTX.

---

## Architecture

```
crawl (Job 1)
├── notify (Job 2)  — analyse IA Claude + email Resend
└── deck   (Job 3)  — génération PPTX + envoi n8n
```

### Fichiers clés

| Chemin | Rôle |
|--------|------|
| `.github/workflows/crawl.yml` | Workflow principal |
| `pipeline/transpose.py` | Pivot crawl_overview.csv → crawl_history.csv |
| `pipeline/ai_analysis.py` | 3 appels Claude (recap email, résumé dashboard, analyse experte) |
| `pipeline/send_report.py` | Envoi email HTML via Resend API |
| `pipeline/generate.js` | Génération deck PPTX (pptxgenjs) |
| `pipeline/parseCrawl.js` | Parser CSV Screaming Frog |
| `pipeline/configs/nordhealth.json` | Config client pour le PPTX |
| `index.html` | Dashboard GitHub Pages |
| `theme.css` | Variables CSS (couleurs, typo) — à modifier par client |
| `results/latest/` | Derniers exports SF (URLs stables pour le dashboard) |
| `results/crawl_history.csv` | Historique agrégé de tous les crawls |

---

## Déclenchement

- **Automatique** : tous les lundis à 7h UTC (9h Paris en été)
- **Manuel** : Actions → *Screaming Frog lite - nordhealth.fi* → Run workflow

---

## Secrets GitHub requis

| Secret | Description |
|--------|-------------|
| `SF_LICENSE_USERNAME` | Email du compte Screaming Frog |
| `SF_LICENSE_KEY` | Clé de licence Screaming Frog |
| `SF_MACHINE_ID` | UUID machine fixe (évite la révocation de licence) |
| `ANTHROPIC_API_KEY` | Clé API Claude (Haiku + Sonnet) |
| `RESEND_API_KEY` | Clé API Resend pour l'envoi email |
| `MAIL_TO` | Destinataire(s) — séparés par virgule si plusieurs |

---

## Dashboard

URL : **https://willotalexispro.github.io/sanity-check-nordhealth/**

Déployé automatiquement depuis la branche `main` via GitHub Pages.

### Onglets

| Onglet | Contenu |
|--------|---------|
| Vue d'ensemble | Cards métriques clés + résumé IA (5 lignes) + graphiques |
| Analyse experte | Analyse Sonnet structurée (santé crawl / problèmes / tendance) |
| On-Page | Titres, meta descriptions, H1/H2 |
| Site Structure | Profondeur, liens internes, pagination |
| Technique | Canonicals, directives, sitemaps |
| Images | Alt text, poids, dimensions |
| Search Console | Données GSC (si configuré) |
| Crawl Overview | Export brut du crawl overview SF |
| Rapport d'erreurs | Issues et warnings SF avec pop-up "How to Fix" |

### Personnalisation par client

Modifier `theme.css` pour adapter les couleurs et la typo :

```css
:root {
  --color-accent:   #3b82f6;   /* couleur principale */
  --header-bg:      #1a1a2e;   /* fond du header */
  --header-text:    #ffffff;
  --tab-active-bg:  #3b82f6;
}
```

---

## Emails

Expéditeur : `noreply@mail.nordhealth.fi` (domaine vérifié sur Resend)

L'email contient :
- Le récap structuré du crawl (métriques + top 5 erreurs + analyse Haiku)
- Un bouton vers le dashboard

---

## Deck PPTX

Généré après chaque crawl via `pipeline/generate.js` (pptxgenjs).

- Comparaison W-o-W automatique si un crawl précédent existe dans `results/`
- Committé dans `results/$DATE/deck_$DATE.pptx`
- Envoyé au webhook n8n : `https://n8n.nordhealth.fi/webhook/44f8feb9-f516-43ce-aacc-e12729743ca8`

---

## Agents IA

Trois appels Claude par crawl :

| Agent | Modèle | Tokens | Usage |
|-------|--------|--------|-------|
| Résumé dashboard | Haiku | 200 | 5 lignes pour la Vue d'ensemble |
| Récap email | Haiku | 500 | Bloc métriques + analyse 2-3 phrases |
| Analyse experte | Sonnet | 1024 | Santé crawl / Problèmes prioritaires / Tendance |

---

## Adapter ce repo à un nouveau client

1. Cloner le repo
2. Mettre à jour les secrets GitHub
3. Modifier `theme.css` (couleurs client)
4. Modifier `pipeline/configs/nordhealth.json` (nom client)
5. Mettre à jour les URLs dans `.github/workflows/crawl.yml` :
   - `--crawl https://nordhealth.fi/`
   - `CRAWL_URL`, `DASHBOARD_URL`, `MAIL_FROM`

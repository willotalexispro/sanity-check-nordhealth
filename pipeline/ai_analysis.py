#!/usr/bin/env python3
"""
ai_analysis.py — Génère une analyse SEO via Claude API à partir des derniers exports SF.

Usage:
    python3 pipeline/ai_analysis.py <crawl_date> <crawl_overview.csv> <issues_overview.csv> <crawl_history.csv> <output.json>
"""

import csv, json, os, sys, urllib.request, urllib.error

def read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))

def read_raw(path):
    if not os.path.exists(path):
        return ""
    with open(path, encoding='utf-8-sig') as f:
        return f.read()

def build_prompt(crawl_date, overview_text, issues_rows, history_rows):

    # ── Crawl overview complet ──
    overview_summary = overview_text.strip()

    # ── Toutes les issues triées par impact (URLs décroissant) ──
    all_issues = sorted(issues_rows, key=lambda r: int(r.get('URLs', '0') or 0), reverse=True)
    issues_text = '\n'.join(
        f"- [{r.get('Issue Type','')} / {r.get('Issue Priority','')}] {r.get('Issue Name','')} : {r.get('URLs','')} URLs — {r.get('Description','')}"
        for r in all_issues
    )

    # ── Tendance historique complète ──
    if len(history_rows) >= 2:
        prev, last = history_rows[-2], history_rows[-1]
        def diff(key):
            try: return int(last.get(key) or 0) - int(prev.get(key) or 0)
            except: return 0
        tracked = [
            ('Total URLs Crawled',                               'URLs crawlées'),
            ('Total Internal Indexable URLs',                    'Pages indexables'),
            ('Total Internal Non-Indexable URLs',                'Pages non-indexables'),
            ('Response Codes:Internal Success (2xx)',            'Réponses 2xx internes'),
            ('Response Codes:Internal Redirection (3xx)',        'Redirections 3xx internes'),
            ('Response Codes:Internal Client Error (4xx)',       'Erreurs 4xx internes'),
            ('Response Codes:Internal Server Error (5xx)',       'Erreurs 5xx internes'),
            ('Response Codes:Internal Redirect Chain',          'Chaînes de redirection'),
            ('Canonicals:Missing',                               'Canonicals manquants'),
            ('Canonicals:Multiple Conflicting',                  'Canonicals conflictuels'),
            ('Page Titles:Missing',                              'Titres manquants'),
            ('Page Titles:Duplicate',                            'Titres dupliqués'),
            ('Meta Description:Missing',                         'Meta desc. manquantes'),
            ('H1:Missing',                                       'H1 manquants'),
            ('Images:Missing Alt Text',                          'Images sans alt text'),
            ('Issues',                                           'Issues totales'),
            ('Warnings',                                         'Warnings totaux'),
        ]
        deltas = [(label, diff(key)) for key, label in tracked if diff(key) != 0]
        if deltas:
            trend_text = '\n'.join(f"- {label}: {'+' if v > 0 else ''}{v}" for label, v in deltas)
        else:
            trend_text = "Aucun changement significatif détecté entre les deux derniers crawls."
        prev_date = prev.get('crawl_date', 'N/A')
        trend_text = f"Comparaison {prev_date} → {crawl_date} :\n{trend_text}"
    else:
        trend_text = "Premier crawl disponible — pas de comparaison possible."

    prompt = f"""Tu es un consultant SEO technique senior. Tu analyses les données d'un crawl Screaming Frog en date du {crawl_date}.

Ton rôle n'est PAS de reformuler ce que les chiffres disent déjà — le client peut les lire lui-même dans son dashboard. Ton rôle est de :
- Identifier les **corrélations non évidentes** entre métriques
- Formuler des **hypothèses sur les causes racines** (pourquoi ce problème existe probablement)
- **Prioriser** selon l'impact SEO réel, pas seulement selon le nombre d'URLs
- Signaler ce qui est **anormal ou surprenant** par rapport à ce qu'on attend d'un site sain
- Proposer des **actions concrètes**, pas des généralités

---

## Crawl Overview complet
{overview_summary}

---

## Liste complète des Issues / Warnings / Opportunities (triées par URLs impactées)
{issues_text}

---

## Évolution depuis le crawl précédent
{trend_text}

---

Rédige une analyse SEO technique en français, structurée ainsi :

### Santé du crawl
2-3 phrases sur ce que révèle ce crawl sur l'état technique du site. Porte le jugement sur les **données du crawl** (couverture, indexabilité, codes réponse, structure) — pas sur le site en lui-même que le lecteur connaît. Est-ce que le crawl révèle un site bien maîtrisé techniquement ou des signaux préoccupants ?

### Problèmes prioritaires
3 à 5 points, ordonnés par impact SEO réel (pas par volume d'URLs). Pour chaque point, utilise cette structure :
**[Nom du problème]** — X URLs impactées
Pourquoi c'est critique : [impact concret sur indexation / ranking / crawl budget / UX]
Cause probable : [hypothèse basée sur les données si possible]
→ Action : [action concrète et précise, pas une généralité]

### Tendance
Structure ce bloc même si peu de données sont disponibles pour l'instant. Si un seul crawl : note les métriques à surveiller en priorité lors des prochains crawls. Si plusieurs crawls : interprète les évolutions — distingue les améliorations structurelles des fluctuations normales, et identifie les signaux préoccupants même faibles.

Règles strictes :
- Ne décris jamais le site (taille, thématique, type de contenu) - le lecteur le connaît
- Chaque recommandation doit être précise et actionnable, pas générique
- Si une corrélation entre métriques est notable, mets-la en avant
- Sois direct, factuel, sans jargon inutile
- Utilise uniquement le tiret court - et jamais le tiret long —
- Maximum 400 mots"""

    return prompt


def call_claude(prompt, api_key, model, max_tokens):
    payload = json.dumps({
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }).encode('utf-8')

    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=payload,
        headers={
            'Content-Type':      'application/json',
            'x-api-key':         api_key,
            'anthropic-version': '2023-06-01',
        }
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    return data['content'][0]['text']


def build_summary_prompt(crawl_date, issues_rows, history_rows):
    """Prompt structuré pour Haiku — récap exécutif avec tableau de métriques."""

    last = history_rows[-1] if history_rows else {}
    prev = history_rows[-2] if len(history_rows) >= 2 else {}

    def v(key):
        try: return int(last.get(key) or 0)
        except: return 0

    def d(key):
        if not prev: return '—'
        try:
            delta = int(last.get(key) or 0) - int(prev.get(key) or 0)
            return f"+{delta}" if delta > 0 else str(delta)
        except: return '—'

    top5 = sorted(issues_rows, key=lambda r: int(r.get('URLs','0') or 0), reverse=True)[:5]
    issues_text = '\n'.join(
        f"- [{r.get('Issue Type','')} / {r.get('Issue Priority','')}] {r.get('Issue Name','')} : {r.get('URLs','')} URLs"
        for r in top5
    )

    metrics_block = f"""📊 URLs crawlées : {v('Total URLs Crawled')}  → {d('Total URLs Crawled')}
✅ 2xx : {v('Response Codes:Internal Success (2xx)')}  → {d('Response Codes:Internal Success (2xx)')}
↪️  3xx redirects : {v('Response Codes:Internal Redirection (3xx)')}  → {d('Response Codes:Internal Redirection (3xx)')}
❌ 4xx erreurs : {v('Response Codes:Internal Client Error (4xx)')}  → {d('Response Codes:Internal Client Error (4xx)')}
💥 5xx erreurs : {v('Response Codes:Internal Server Error (5xx)')}  → {d('Response Codes:Internal Server Error (5xx)')}
🔴 Sans titre : {v('Page Titles:Missing')}  → {d('Page Titles:Missing')}
🟡 Sans meta desc : {v('Meta Description:Missing')}  → {d('Meta Description:Missing')}
🚫 Non-indexables : {v('Total Internal Non-Indexable URLs')}  → {d('Total Internal Non-Indexable URLs')}"""

    return f"""Tu es un assistant SEO. Génère un récapitulatif de crawl structuré en français, en suivant EXACTEMENT ce format :

Récap du crawl :
────────────────────────────────────────
{metrics_block}
────────────────────────────────────────

Principales erreurs :

{issues_text}

Analyse récap — Généré le {crawl_date} :
[Écris ici 2-3 phrases factuelles et professionnelles. Style "update hebdomadaire". Commente l'état général, les points d'attention prioritaires, et l'évolution si des données de comparaison sont disponibles. Pas de jargon, pas de généralités — sois direct et actionnable.]

Règles strictes :
- Reproduis le bloc métriques et les erreurs EXACTEMENT comme fournis ci-dessus, sans les modifier
- Seule la partie "Analyse récap" est à rédiger
- Ton neutre et professionnel
- Exactement 2-3 phrases pour l'analyse, jamais moins, jamais plus — phrase complète obligatoire"""


def build_dashboard_prompt(crawl_date, issues_rows, history_rows):
    """Prompt Haiku — résumé ultra-court 5 lignes pour le bloc Vue d'ensemble."""

    last = history_rows[-1] if history_rows else {}
    prev = history_rows[-2] if len(history_rows) >= 2 else {}

    def v(key):
        try: return int(last.get(key) or 0)
        except: return 0

    def d(key):
        if not prev: return None
        try: return int(last.get(key) or 0) - int(prev.get(key) or 0)
        except: return None

    top3 = sorted(issues_rows, key=lambda r: int(r.get('URLs','0') or 0), reverse=True)[:3]
    issues_text = ', '.join(
        f"{r.get('Issue Name','')} ({r.get('URLs','')} URLs)"
        for r in top3
    )

    delta_4xx = d('Response Codes:Internal Client Error (4xx)')
    delta_idx  = d('Total Internal Indexable URLs')

    context = f"""Crawl du {crawl_date} — {v('Total URLs Crawled')} URLs crawlées, {v('Total Internal Indexable URLs')} indexables, {v('Response Codes:Internal Client Error (4xx)')} erreurs 4xx, {v('Response Codes:Internal Server Error (5xx)')} erreurs 5xx.
Top issues : {issues_text}.
{"Évolution : 4xx " + (f"+{delta_4xx}" if delta_4xx and delta_4xx > 0 else str(delta_4xx)) + ", pages indexables " + (f"+{delta_idx}" if delta_idx and delta_idx > 0 else str(delta_idx)) + "." if prev else "Premier crawl disponible."}"""

    return f"""Tu es un assistant SEO. À partir de ces données de crawl, rédige exactement 5 lignes en français.

Données :
{context}

Format attendu — exactement 5 lignes numérotées, une idée par ligne, pas de titre, pas de markdown :
1. État général du site en une phrase.
2. Point positif ou métrique rassurante.
3. Problème prioritaire n°1 avec chiffre.
4. Problème prioritaire n°2 avec chiffre.
5. Une action concrète à mener en priorité.

Règles : phrases courtes, chiffres obligatoires, ton direct, aucun jargon."""


def main():
    if len(sys.argv) != 6:
        print("Usage: ai_analysis.py <crawl_date> <crawl_overview.csv> <issues_overview.csv> <crawl_history.csv> <output.json>")
        sys.exit(1)

    crawl_date   = sys.argv[1]
    overview_csv = sys.argv[2]
    issues_csv   = sys.argv[3]
    history_csv  = sys.argv[4]
    output_json  = sys.argv[5]

    api_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if not api_key:
        print("ANTHROPIC_API_KEY non définie, analyse IA ignorée.")
        sys.exit(0)

    overview_text = read_raw(overview_csv)
    issues_rows   = read_csv(issues_csv)
    history_rows  = read_csv(history_csv)

    summary_prompt    = build_summary_prompt(crawl_date, issues_rows, history_rows)
    dashboard_prompt  = build_dashboard_prompt(crawl_date, issues_rows, history_rows)
    analysis_prompt   = build_prompt(crawl_date, overview_text, issues_rows, history_rows)

    print("Appel Haiku (récap email)…")
    summary           = call_claude(summary_prompt,   api_key, "claude-haiku-4-5-20251001", 500)
    print("Appel Haiku (résumé dashboard)…")
    dashboard_summary = call_claude(dashboard_prompt, api_key, "claude-haiku-4-5-20251001", 200)
    print("Appel Sonnet (analyse experte)…")
    analysis          = call_claude(analysis_prompt,  api_key, "claude-sonnet-4-6",         8192)

    result = {
        "crawl_date":        crawl_date,
        "generated_at":      crawl_date,
        "summary":           summary,
        "dashboard_summary": dashboard_summary,
        "analysis":          analysis,
    }

    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"OK — récap email ({len(summary)} car.) + résumé dashboard ({len(dashboard_summary)} car.) + analyse ({len(analysis)} car.) → {output_json}")

if __name__ == '__main__':
    main()

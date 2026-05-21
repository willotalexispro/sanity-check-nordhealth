#!/usr/bin/env python3
"""
transpose.py — Transforme un crawl_overview_report.csv + issues_overview_report.csv
en une ligne dans un fichier historique cumulatif à header fixe.

Usage:
    python3 transpose.py <crawl_date> <crawl_overview.csv> <issues_overview.csv> <history.csv>
"""

import csv, os, sys

# ── Header fixe ──────────────────────────────────────────────────────────────
HEADERS = [
    "Site Crawled","Start Date","Start Time","Last Modified Date","Last Modified Time",
    "Elapsed","Report Date","Report Time",
    "Total URLs Encountered","Total URLs Crawled",
    "Total Internal blocked by robots.txt","Total External blocked by robots.txt",
    "URLs Displayed","Total Internal URLs","Total External URLs",
    "Total Internal Indexable URLs","Total Internal Non-Indexable URLs",
    "JavaScript:All","JavaScript:Uses Old AJAX Crawling Scheme URLs",
    "JavaScript:Uses Old AJAX Crawling Scheme Meta Fragment Tag",
    "JavaScript:Page Title Only in Rendered HTML","JavaScript:Page Title Updated by JavaScript",
    "JavaScript:H1 Only in Rendered HTML","JavaScript:H1 Updated by JavaScript",
    "JavaScript:Meta Description Only in Rendered HTML","JavaScript:Meta Description Updated by JavaScript",
    "JavaScript:Canonical Only in Rendered HTML","JavaScript:Canonical Mismatch",
    "JavaScript:Noindex Only in Original HTML","JavaScript:Nofollow Only in Original HTML",
    "JavaScript:Contains JavaScript Links","JavaScript:Contains JavaScript Content",
    "JavaScript:Pages with Blocked Resources","JavaScript:Pages with JavaScript Errors",
    "JavaScript:Pages with JavaScript Warnings","JavaScript:Pages with Chrome Issues",
    "H1:All","H1:Missing","H1:Duplicate","H1:Over X Characters","H1:Multiple",
    "H1:Alt Text in H1","H1:Non-Sequential",
    "H2:All","H2:Missing","H2:Duplicate","H2:Over X Characters","H2:Multiple","H2:Non-Sequential",
    "Internal:All","Internal:HTML","Internal:JavaScript","Internal:CSS","Internal:Images",
    "Internal:Plugins","Internal:Media","Internal:Fonts","Internal:XML","Internal:PDF",
    "Internal:Other","Internal:Unknown",
    "External:All","External:HTML","External:JavaScript","External:CSS","External:Images",
    "External:Plugins","External:Media","External:Fonts","External:XML","External:PDF",
    "External:Other","External:Unknown",
    "AMP:All","AMP:Non-200 Response","AMP:Missing Non-AMP Return Link",
    "AMP:Missing Canonical to Non-AMP","AMP:Non-Indexable Canonical","AMP:Indexable",
    "AMP:Non-Indexable","AMP:Missing <html amp> Tag","AMP:Missing/Invalid <!doctype html> Tag",
    "AMP:Missing <head> Tag","AMP:Missing <body> Tag","AMP:Missing Canonical",
    "AMP:Missing/Invalid <meta charset> Tag","AMP:Missing/Invalid <meta viewport> Tag",
    "AMP:Missing/Invalid AMP Script","AMP:Missing/Invalid AMP Boilerplate",
    "AMP:Contains Disallowed HTML","AMP:Other Validation Errors",
    "Canonicals:All","Canonicals:Contains Canonical","Canonicals:Self Referencing",
    "Canonicals:Canonicalised","Canonicals:Missing","Canonicals:Multiple",
    "Canonicals:Non-Indexable Canonical","Canonicals:Multiple Conflicting",
    "Canonicals:Canonical Is Relative","Canonicals:Unlinked",
    "Canonicals:Invalid Attribute In Annotation","Canonicals:Contains Fragment URL",
    "Canonicals:Outside <head>",
    "Content:All","Content:Spelling Errors","Content:Grammar Errors","Content:Near Duplicates",
    "Content:Semantically Similar","Content:Low Relevance Content","Content:Exact Duplicates",
    "Content:Low Content Pages","Content:Readability Difficult","Content:Readability Very Difficult",
    "Content:Lorem Ipsum Placeholder","Content:Soft 404 Pages",
    "Custom Extraction:All","Custom Search:All","Custom JavaScript:All",
    "Directives:All","Directives:Index","Directives:Noindex","Directives:Follow",
    "Directives:Nofollow","Directives:None","Directives:NoArchive","Directives:NoSnippet",
    "Directives:Max-Snippet","Directives:Max-Image-Preview","Directives:Max-Video-Preview",
    "Directives:NoODP","Directives:NoYDIR","Directives:NoImageIndex","Directives:NoTranslate",
    "Directives:Unavailable_After","Directives:Refresh","Directives:Outside <head>",
    "Analytics:All","Analytics:Sessions Above 0","Analytics:Bounce Rate Above 70%",
    "Analytics:No GA Data","Analytics:Non-Indexable with GA Data","Analytics:Orphan URLs",
    "Search Console:All","Search Console:Clicks Above 0","Search Console:No Search Analytics Data",
    "Search Console:Non-Indexable with Search Analytics Data","Search Console:Orphan URLs",
    "Search Console:URL is Not on Google","Search Console:Indexable URL Not Indexed",
    "Search Console:URL is on Google But Has Issues",
    "Search Console:User-Declared Canonical Not Selected",
    "Search Console:Page is Not Mobile Friendly","Search Console:AMP URL Invalid",
    "Search Console:Rich Result Invalid",
    "Hreflang:All","Hreflang:Contains hreflang","Hreflang:Non-200 hreflang URLs",
    "Hreflang:Unlinked hreflang URLs","Hreflang:Missing Return Links",
    "Hreflang:Inconsistent Language & Region Return Links","Hreflang:Non-Canonical Return Links",
    "Hreflang:Noindex Return Links","Hreflang:Incorrect Language & Region Codes",
    "Hreflang:Multiple Entries","Hreflang:Missing Self Reference","Hreflang:Not Using Canonical",
    "Hreflang:Missing X-Default","Hreflang:Missing","Hreflang:Outside <head>",
    "Images:All","Images:Over X KB","Images:Missing Alt Text","Images:Missing Alt Attribute",
    "Images:Alt Text Over X Characters","Images:Background Images",
    "Images:Incorrectly Sized Images","Images:Missing Size Attributes",
    "Link Metrics:All",
    "Meta Description:All","Meta Description:Missing","Meta Description:Duplicate",
    "Meta Description:Over X Characters","Meta Description:Below X Characters",
    "Meta Description:Over X Pixels","Meta Description:Below X Pixels",
    "Meta Description:Multiple","Meta Description:Outside <head>",
    "Meta Keywords:All","Meta Keywords:Missing","Meta Keywords:Duplicate","Meta Keywords:Multiple",
    "PageSpeed:All","PageSpeed:Minify CSS","PageSpeed:Minify JavaScript",
    "PageSpeed:Reduce Unused CSS","PageSpeed:Reduce Unused JavaScript",
    "PageSpeed:Reduce JavaScript Execution Time","PageSpeed:Minimize Main-Thread Work",
    "PageSpeed:Request Errors","PageSpeed:Layout Shift Culprits",
    "PageSpeed:Document Request Latency","PageSpeed:Optimize DOM Size","PageSpeed:Font Display",
    "PageSpeed:Improve Image Delivery","PageSpeed:Legacy JavaScript",
    "PageSpeed:Render Blocking Requests","PageSpeed:Use Efficient Cache Lifetimes",
    "PageSpeed:LCP Request Discovery","PageSpeed:Forced Reflow",
    "PageSpeed:Avoid Enormous Network Payloads","PageSpeed:Network Dependency Tree",
    "PageSpeed:Duplicated JavaScript",
    "Pagination:All","Pagination:Contains Pagination","Pagination:First Page",
    "Pagination:Paginated 2+ Pages","Pagination:Pagination URL Not in Anchor Tag",
    "Pagination:Non-200 Pagination URLs","Pagination:Unlinked Pagination URLs",
    "Pagination:Non-Indexable","Pagination:Multiple Pagination URLs",
    "Pagination:Pagination Loop","Pagination:Sequence Error",
    "Response Codes:All","Response Codes:Blocked by Robots.txt","Response Codes:Blocked Resource",
    "Response Codes:No Response","Response Codes:Success (2xx)","Response Codes:Redirection (3xx)",
    "Response Codes:Redirection (JavaScript)","Response Codes:Redirection (Meta Refresh)",
    "Response Codes:Redirection (HTTP Refresh)","Response Codes:Client Error (4xx)",
    "Response Codes:Server Error (5xx)","Response Codes:Internal All",
    "Response Codes:Internal Blocked by Robots.txt","Response Codes:Internal Blocked Resource",
    "Response Codes:Internal No Response","Response Codes:Internal Success (2xx)",
    "Response Codes:Internal Redirection (3xx)","Response Codes:Internal Redirection (JavaScript)",
    "Response Codes:Internal Redirection (Meta Refresh)",
    "Response Codes:Internal Redirection (HTTP Refresh)",
    "Response Codes:Internal Redirect Chain","Response Codes:Internal Redirect Loop",
    "Response Codes:Internal Client Error (4xx)","Response Codes:Internal Server Error (5xx)",
    "Response Codes:External All","Response Codes:External Blocked by Robots.txt",
    "Response Codes:External Blocked Resource","Response Codes:External No Response",
    "Response Codes:External Success (2xx)","Response Codes:External Redirection (3xx)",
    "Response Codes:External Redirection (JavaScript)",
    "Response Codes:External Redirection (Meta Refresh)",
    "Response Codes:External Redirection (HTTP Refresh)",
    "Response Codes:External Client Error (4xx)","Response Codes:External Server Error (5xx)",
    "Security:All","Security:HTTP URLs","Security:HTTPS URLs","Security:Mixed Content",
    "Security:Form URL Insecure","Security:Form on HTTP URL","Security:Unsafe Cross-Origin Links",
    "Security:Missing HSTS Header","Security:Bad Content Type",
    "Security:Missing X-Content-Type-Options Header","Security:Missing X-Frame-Options Header",
    "Security:Protocol-Relative Resource Links","Security:Missing Content-Security-Policy Header",
    "Security:Missing Secure Referrer-Policy Header",
    "Sitemaps:All","Sitemaps:URLs in Sitemap","Sitemaps:URLs not in Sitemap",
    "Sitemaps:Orphan URLs","Sitemaps:Non-Indexable URLs in Sitemap",
    "Sitemaps:URLs in Multiple Sitemaps","Sitemaps:XML Sitemap with over 50k URLs",
    "Sitemaps:XML Sitemap over 50MB",
    "Structured Data:All","Structured Data:Contains Structured Data","Structured Data:Missing",
    "Structured Data:Validation Errors","Structured Data:Validation Warnings",
    "Structured Data:Rich Result Validation Errors","Structured Data:Rich Result Validation Warnings",
    "Structured Data:Parse Errors","Structured Data:Microdata URLs","Structured Data:JSON-LD URLs",
    "Structured Data:RDFa URLs","Structured Data:Rich Result Feature Detected",
    "Page Titles:All","Page Titles:Missing","Page Titles:Duplicate","Page Titles:Over X Characters",
    "Page Titles:Below X Characters","Page Titles:Over X Pixels","Page Titles:Below X Pixels",
    "Page Titles:Same as H1","Page Titles:Multiple","Page Titles:Outside <head>",
    "URL:All","URL:Non ASCII Characters","URL:Underscores","URL:Uppercase","URL:Parameters",
    "URL:Over X Characters","URL:Multiple Slashes","URL:Repetitive Path","URL:Contains Space",
    "URL:Broken Bookmark","URL:Internal Search","URL:GA Tracking Parameters",
    "Links:All","Links:Pages Without Internal Outlinks","Links:Internal Nofollow Outlinks",
    "Links:Internal Outlinks With No Anchor Text",
    "Links:Non-Descriptive Anchor Text In Internal Outlinks",
    "Links:Pages With High External Outlinks","Links:Pages With High Internal Outlinks",
    "Links:Follow & Nofollow Internal Inlinks To Page","Links:Internal Nofollow Inlinks Only",
    "Links:Pages With High Crawl Depth","Links:Outlinks To Localhost",
    "Links:Non-Indexable Page Inlinks Only",
    "Validation:All","Validation:Invalid HTML Elements in <head>",
    "Validation:<head> Not First In <html> Element","Validation:Missing <head> Tag",
    "Validation:Multiple <head> Tags","Validation:Missing <body> Tag",
    "Validation:Multiple <body> Tags","Validation:HTML Document Over XMB",
    "Validation:Resource Over XMB","Validation:<body> Element Preceding <html>",
    "Validation:High Carbon Rating",
    "Mobile:All","Mobile:Viewport Not Set","Mobile:Target Size",
    "Mobile:Content Not Sized Correctly","Mobile:Illegible Font Size",
    "Mobile:Contains Unsupported Plugins","Mobile:Mobile Alternate Link",
    "AI:All",
    "Accessibility:All","Accessibility:Accessibility Score Poor",
    "Accessibility:Accessibility Score Needs Improvement","Accessibility:Accessibility Score Good",
    "Accessibility:Best Practice Violation","Accessibility:WCAG 2.0 A Violation",
    "Accessibility:WCAG 2.0 AA Violation","Accessibility:WCAG 2.0 AAA Violation",
    "Accessibility:WCAG 2.1 AA Violation","Accessibility:WCAG 2.2 AA Violation",
    # Depth
    "Depth 1","Depth 2","Depth 3","Depth 4","Depth 5",
    "Depth 6","Depth 7","Depth 8","Depth 9","Depth 10+",
    # Top inlinks
    "Top Inlinks 1 URL","Top Inlinks 1 Number of Inlinks",
    "Top Inlinks 2 URL","Top Inlinks 2 Number of Inlinks",
    "Top Inlinks 3 URL","Top Inlinks 3 Number of Inlinks",
    "Top Inlinks 4 URL","Top Inlinks 4 Number of Inlinks",
    "Top Inlinks 5 URL","Top Inlinks 5 Number of Inlinks",
    "Top Inlinks 6 URL","Top Inlinks 6 Number of Inlinks",
    "Top Inlinks 7 URL","Top Inlinks 7 Number of Inlinks",
    "Top Inlinks 8 URL","Top Inlinks 8 Number of Inlinks",
    "Top Inlinks 9 URL","Top Inlinks 9 Number of Inlinks",
    "Top Inlinks 10 URL","Top Inlinks 10 Number of Inlinks",
    "Top Inlinks 11 URL","Top Inlinks 11 Number of Inlinks",
    "Top Inlinks 12 URL","Top Inlinks 12 Number of Inlinks",
    "Top Inlinks 13 URL","Top Inlinks 13 Number of Inlinks",
    "Top Inlinks 14 URL","Top Inlinks 14 Number of Inlinks",
    "Top Inlinks 15 URL","Top Inlinks 15 Number of Inlinks",
    "Top Inlinks 16 URL","Top Inlinks 16 Number of Inlinks",
    "Top Inlinks 17 URL","Top Inlinks 17 Number of Inlinks",
    "Top Inlinks 18 URL","Top Inlinks 18 Number of Inlinks",
    "Top Inlinks 19 URL","Top Inlinks 19 Number of Inlinks",
    "Top Inlinks 20 URL","Top Inlinks 20 Number of Inlinks",
    # Response times
    "Response Times 0s to 1s","Response Times 1s to 2s","Response Times 2s to 3s",
    "Response Times 3s to 4s","Response Times 4s to 5s","Response Times 5s to 6s",
    "Response Times 6s to 7s","Response Times 7s to 8s","Response Times 8s to 9s",
    "Response Times 10s or more",
    # Issues overview
    "Issues Total","Issues","Warnings","Opportunities",
]

def parse_crawl_overview(filepath):
    """Parse le crawl_overview SF en un dict plat avec clés Section:Metric."""
    result = {}
    current_section = None

    with open(filepath, newline='', encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))

    i = 0
    while i < len(rows):
        row = rows[i]
        col_a = row[0].strip() if row else ''
        col_b = row[1].strip() if len(row) > 1 else ''

        if not col_a:
            i += 1
            continue

        # ── Sections spéciales avec données pivotées ──────────────────────
        if col_a == 'Depth (Clicks from Start URL)':
            # Lignes suivantes : col_a = profondeur (0,1,...,10+), col_b = count
            i += 1
            while i < len(rows):
                r = rows[i]
                if not r or not r[0].strip():
                    break
                depth = r[0].strip()
                count = r[1].strip() if len(r) > 1 else ''
                if depth == '0':
                    result['Depth 0'] = count
                else:
                    result[f'Depth {depth}'] = count
                i += 1
            continue

        if col_a == 'Inlinks (Top 20 URLs)':
            # Lignes suivantes : col_a = URL, col_b = count
            i += 1
            idx = 1
            while i < len(rows) and idx <= 20:
                r = rows[i]
                if not r or not r[0].strip():
                    break
                url   = r[0].strip()
                count = r[1].strip() if len(r) > 1 else ''
                result[f'Top Inlinks {idx} URL'] = url
                result[f'Top Inlinks {idx} Number of Inlinks'] = count
                idx += 1
                i += 1
            continue

        if col_a == 'Response Time (Seconds)':
            # Lignes suivantes : col_a = secondes (1,2,...), col_b = count
            # Mapping : "1" → "0s to 1s", "2" → "1s to 2s", etc.
            i += 1
            while i < len(rows):
                r = rows[i]
                if not r or not r[0].strip():
                    break
                sec   = r[0].strip()
                count = r[1].strip() if len(r) > 1 else ''
                try:
                    n = int(sec)
                    label = f'Response Times {n-1}s to {n}s' if n <= 9 else 'Response Times 10s or more'
                except ValueError:
                    label = f'Response Times {sec}'
                result[label] = count
                i += 1
            continue

        # ── Section header ou metric ──────────────────────────────────────
        # Règles :
        # 1. col_b vide → section header sans données
        # 2. col_b numérique → métrique (même si col_c existe, ex: "13227","100%",...)
        # 3. col_b non-numérique + col_c non vide → section header (ex: "Summary","URLs","% of Total")
        # 4. col_b non-numérique + col_c vide → métadonnée top-level (ex: "Site Crawled","https://...")
        col_c = row[2].strip() if len(row) > 2 else ''

        is_header = False
        if not col_b:
            is_header = True
        else:
            try:
                float(col_b.replace(',', ''))
                # col_b numérique → métrique, jamais un header
            except ValueError:
                # col_b non-numérique : header seulement si col_c présent
                if col_c:
                    is_header = True

        if is_header:
            current_section = col_a
            i += 1
            continue

        # Ligne métrique normale (col_b numérique ou métadonnée top-level)
        if current_section in (None, 'Summary'):
            result[col_a] = col_b
        else:
            result[f'{current_section}:{col_a}'] = col_b
        i += 1

    return result


def parse_issues_overview(filepath):
    """Compte Issues / Warnings / Opportunities depuis issues_overview_report.csv."""
    counts = {'Issues': 0, 'Warnings': 0, 'Opportunities': 0}
    if not os.path.exists(filepath):
        return counts
    with open(filepath, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            t = row.get('Issue Type', '').strip()
            if t == 'Issue':
                counts['Issues'] += 1
            elif t == 'Warning':
                counts['Warnings'] += 1
            elif t == 'Opportunity':
                counts['Opportunities'] += 1
    counts['Issues Total'] = counts['Issues'] + counts['Warnings'] + counts['Opportunities']
    return counts


def main():
    if len(sys.argv) != 5:
        print("Usage: transpose.py <crawl_date> <crawl_overview.csv> <issues_overview.csv> <history.csv>")
        sys.exit(1)

    crawl_date    = sys.argv[1]
    overview_csv  = sys.argv[2]
    issues_csv    = sys.argv[3]
    history_csv   = sys.argv[4]

    if not os.path.exists(overview_csv):
        print(f"Fichier introuvable : {overview_csv}")
        sys.exit(1)

    data = parse_crawl_overview(overview_csv)
    data.update(parse_issues_overview(issues_csv))
    data['crawl_date'] = crawl_date

    # Construire la ligne dans l'ordre du header fixe
    all_headers = ['crawl_date'] + HEADERS
    row = {h: data.get(h, '') for h in all_headers}

    # Lire les lignes existantes
    existing_rows = []
    if os.path.exists(history_csv):
        with open(history_csv, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            existing_rows = list(reader)

    # Écrire
    with open(history_csv, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=all_headers, extrasaction='ignore')
        writer.writeheader()
        for r in existing_rows:
            writer.writerow({h: r.get(h, '') for h in all_headers})
        writer.writerow(row)

    filled = sum(1 for v in row.values() if v)
    print(f"OK — {history_csv} mis à jour ({filled}/{len(all_headers)} colonnes remplies)")

if __name__ == '__main__':
    main()

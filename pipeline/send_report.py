#!/usr/bin/env python3
"""
send_report.py — Envoie le récap du crawl par email via Resend API.

Usage:
    python3 pipeline/send_report.py <ai_analysis.json>
"""

import json, os, sys, urllib.request

def send_email(api_key, mail_from, mail_to, subject, html):
    recipients = [m.strip() for m in mail_to.split(',') if m.strip()]
    payload = json.dumps({
        "from":    mail_from,
        "to":      recipients,
        "subject": subject,
        "html":    html,
    }).encode('utf-8')

    req = urllib.request.Request(
        'https://api.resend.com/emails',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type':  'application/json',
            'User-Agent':    'sanity-check-seo/1.0',
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"Resend API {e.code}: {body}") from None

def md_to_html(text):
    """Conversion markdown basique → HTML pour l'email."""
    lines = text.split('\n')
    html = ''
    in_list = False
    for line in lines:
        l = line.strip()
        if not l:
            if in_list: html += '</ul>'; in_list = False
            continue
        if l.startswith('### ') or l.startswith('## ') or l.startswith('# '):
            if in_list: html += '</ul>'; in_list = False
            title = l.lstrip('#').strip()
            html += f'<h3 style="margin:18px 0 6px;font-size:14px;color:#1a1a2e">{title}</h3>'
        elif l.startswith('- ') or l.startswith('* '):
            if not in_list: html += '<ul style="margin:6px 0 10px 20px;padding:0">'; in_list = True
            content = l[2:].replace('**', '<strong>').replace('**', '</strong>')
            html += f'<li style="margin:4px 0;font-size:13px;line-height:1.6">{content}</li>'
        else:
            if in_list: html += '</ul>'; in_list = False
            content = l.replace('**', '<strong>').replace('**', '</strong>')
            html += f'<p style="margin:6px 0;font-size:13px;line-height:1.6">{content}</p>'
    if in_list: html += '</ul>'
    return html

def build_html(crawl_date, site, summary, analysis_url):
    summary_html = md_to_html(summary)
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa;padding:32px 0">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a2e;padding:20px 28px">
            <p style="margin:0;color:#ffffff;font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.6">Rapport SEO automatique</p>
            <h1 style="margin:4px 0 0;color:#ffffff;font-size:18px;font-weight:700">{site}</h1>
          </td>
        </tr>

        <!-- Date badge -->
        <tr>
          <td style="background:#f0f4ff;padding:10px 28px;border-bottom:1px solid #e8eaf0">
            <p style="margin:0;font-size:12px;color:#555">Crawl du <strong>{crawl_date}</strong></p>
          </td>
        </tr>

        <!-- Récap Haiku -->
        <tr>
          <td style="padding:24px 28px 20px">
            <p style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#3182ce">✦ Récap du crawl</p>
            <div style="border-left:3px solid #3182ce;padding-left:14px;color:#1a1a2e">
              {summary_html}
            </div>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:0 28px 28px">
            <a href="{analysis_url}" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:13px;font-weight:600">
              Voir l'analyse complète →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f5f6fa;padding:14px 28px;border-top:1px solid #e8eaf0">
            <p style="margin:0;font-size:11px;color:#999">Généré automatiquement après chaque analyse SEO · <a href="{analysis_url}" style="color:#3182ce;text-decoration:none">Dashboard SEO</a></p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

def main():
    if len(sys.argv) != 2:
        print("Usage: send_report.py <ai_analysis.json>")
        sys.exit(1)

    analysis_json = sys.argv[1]

    api_key   = os.environ.get('RESEND_API_KEY', '')
    mail_to   = os.environ.get('MAIL_TO', '')
    mail_from = os.environ.get('MAIL_FROM', 'SEO Report <noreply@mail.spilou.com>')

    if not api_key:
        print("RESEND_API_KEY non définie, envoi ignoré.")
        sys.exit(0)
    if not mail_to:
        print("MAIL_TO non définie, envoi ignoré.")
        sys.exit(0)

    with open(analysis_json, encoding='utf-8') as f:
        data = json.load(f)

    crawl_date   = data.get('crawl_date', '—')
    summary      = data.get('summary', 'Aucun récap disponible.')
    site         = os.environ.get('CRAWL_URL', 'spilou.com')
    dashboard_url = os.environ.get('DASHBOARD_URL', 'https://willotalexispro.github.io/sanity-check-spilou/')

    subject = f"Rapport SEO {site} — {crawl_date}"
    html    = build_html(crawl_date, site, summary, dashboard_url)

    result  = send_email(api_key, mail_from, mail_to, subject, html)
    print(f"OK — email envoyé à {mail_to} (id: {result.get('id','?')})")

if __name__ == '__main__':
    main()

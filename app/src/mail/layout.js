// @ts-check
/**
 * Opmaak van de e-mails van de app (Beheer > E-mail > Mail-opmaak): e-mailveilige HTML met tabellen en inline stijlen,
 * het logo van de site als ingebedde bijlage (`cid:`), een kopbalk in de ingestelde kleur en een voettekst. Elke mail
 * krijgt ook een platte-tekstversie. Alle waarden gaan via `html\`…\`` (escaping); er komt nooit invoer als HTML in.
 * Eén opmaak voor alle mails, zonder instelbare teksten per mailtype.
 */
const fs = require('node:fs');
const path = require('node:path');
const { html, raw, toString } = require('../site/html');
const { PUBLIC_DIR } = require('../paths');

/** Content-ID van het ingebedde logo. */
const LOGO_CID = 'logo@avantareizen';

/** Het logo van de site, één keer gelezen (leeg als het bestand ontbreekt). */
let logoCache = null;

/**
 * Het logo als buffer, of null als het ontbreekt.
 * @returns {(Buffer|null)} De PNG.
 */
function logoBuffer() {
  if (logoCache === null) {
    try {
      logoCache = fs.readFileSync(path.join(PUBLIC_DIR, 'images', 'logo.png'));
    } catch (_) {
      logoCache = Buffer.alloc(0);
    }
  }
  return logoCache.length ? logoCache : null;
}

/**
 * Relatieve helderheid van een kleur (WCAG 2), voor de contrastcontrole.
 * @param {string} hex Kleur als `#rrggbb`.
 * @returns {number} Helderheid van 0 tot 1.
 */
function luminance(hex) {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Contrast tussen een kleur en wit (WCAG 2).
 * @param {string} hex Kleur als `#rrggbb`.
 * @returns {number} Contrastverhouding (1 tot 21).
 */
function contrastWithWhite(hex) {
  return 1.05 / (luminance(hex) + 0.05);
}

/**
 * Bouwt een mail: kop met logo, titelbalk, inleiding, een tabel met gegevens, eventueel opgemaakte tekst, een blok
 * vrije tekst en de voettekst.
 * @param {{title: string, intro?: string, rows?: Array<[string, string]>, richHtml?: string, richText?: string, body?: string, action?: {label: string, url: string}, headerColor: string, footerText?: string, siteName: string}} content
 *   Titel, inleiding, rijen (label, waarde; lege waarden vallen weg), opgemaakte tekst (`richHtml`: alleen de uitkomst
 *   van `mailHtmlFromRichText` in `mail/rich-text.js`, nooit ruwe invoer; `richText` de platte versie ervan), vrije
 *   tekst (regeleinden blijven), eventueel een knop (alleen een https-adres), kleur van de titelbalk, voettekst en naam
 *   van de site (alt-tekst van het logo).
 * @returns {{html: string, text: string, attachments: object[]}} HTML, platte tekst en het logo als ingebedde bijlage.
 */
function renderMail(content) {
  const rows = (content.rows || []).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  const logo = logoBuffer();
  const action = content.action && /^https:\/\/[^\s"'<>]+$/.test(String(content.action.url)) ? content.action : null;
  const color = content.headerColor;
  const cell = 'padding:6px 12px 6px 0;vertical-align:top;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#434248;';
  const paragraphs = (text) => String(text || '').split(/\n{2,}/).filter((part) => part.trim())
    .map((part) => html`<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#434248;">${part.split('\n').map((line, index) => (index ? [html`<br>`, line] : line))}</p>`);
  const markup = html`<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${content.title}</title></head>
<body style="margin:0;padding:0;background:#f3ede6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ede6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:4px;">
${logo ? html`<tr><td style="padding:20px 24px 12px;"><img src="cid:${LOGO_CID}" alt="${content.siteName}" height="48" style="display:block;height:48px;width:auto;border:0;"></td></tr>` : ''}
<tr><td style="background:${color};padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;font-weight:bold;color:#ffffff;">${content.title}</td></tr>
<tr><td style="padding:20px 24px 8px;">
${paragraphs(content.intro)}
${rows.length ? html`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">${rows.map(([label, value]) => html`<tr><td style="${cell}font-weight:bold;white-space:nowrap;">${label}</td><td style="${cell}">${value}</td></tr>`)}</table>` : ''}
${content.richHtml ? html`<div style="margin:0 0 4px;">${raw(content.richHtml)}</div>` : ''}
${content.body ? html`<div style="margin:4px 0 12px;padding:12px;background:#f7f7f7;border-left:3px solid ${color};">${paragraphs(content.body)}</div>` : ''}
${action ? html`<p style="margin:8px 0 16px;"><a href="${action.url}" style="display:inline-block;padding:10px 18px;background:${color};border-radius:4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">${action.label}</a></p>` : ''}
</td></tr>
${content.footerText ? html`<tr><td style="padding:12px 24px 20px;border-top:1px solid #e4e2df;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b6b6b;">${content.footerText.split('\n').map((line, index) => (index ? [html`<br>`, line] : line))}</td></tr>` : ''}
</table>
</td></tr></table>
</body></html>`;
  const text = [
    content.title,
    '',
    content.intro || '',
    rows.length ? `\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}` : '',
    content.richText ? `\n${content.richText}` : '',
    content.body ? `\n${content.body}` : '',
    action ? `\n${action.label}: ${action.url}` : '',
    content.footerText ? `\n--\n${content.footerText}` : '',
  ].filter((part, index) => index < 2 || part).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    html: toString(markup),
    text: `${text}\n`,
    attachments: logo ? [{ filename: 'logo.png', content: logo, contentType: 'image/png', cid: LOGO_CID, contentDisposition: 'inline' }] : [],
  };
}

module.exports = { renderMail, contrastWithWhite, LOGO_CID };

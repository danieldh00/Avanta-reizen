// @ts-check
/**
 * Migratie 34: website: de laatste vaste inhoud in het CRM (W28).
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 *
 * - `list_headers`: de koppen van de lijstpagina's (reizen, reisleiders, blog, FAQ en aanmelden) met pretitel, titel,
 *   inleiding en foto. De rijen beginnen met de teksten van de huidige site; `source` zegt waar de inhoud vandaan komt
 *   (`standaard`, `bestand` na het overzetten uit `site-content.json`, `crm` na een wijziging in het CRM).
 * - `guides`: de fotogalerij onder de pagina van een reisleider (titel, subtitel en foto's als JSON-lijst van
 *   `{mediaId?, url, alt}`, zoals de galerij van een reis).
 * - `content_transfers`: welke delen van de vaste inhoud al uit de JSON-bestanden in DATA_DIR zijn overgezet, zodat dat
 *   precies één keer gebeurt.
 */
module.exports = {
  id: 34,
  name: 'website: vaste inhoud in het crm',
  sql: `
      CREATE TABLE list_headers (
        key TEXT PRIMARY KEY CHECK (key IN ('reis', 'reisleider', 'blog', 'faq', 'aanmelden')),
        pretitle TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        introduction TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        source TEXT NOT NULL DEFAULT 'standaard' CHECK (source IN ('standaard', 'bestand', 'crm')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO list_headers (key, pretitle, title, introduction) VALUES
        ('reis', '40 jaar wereldwijde ervaring', 'Ons reisaanbod', ''),
        ('reisleider', 'Ervaren avanturiers', 'Reisleiders', 'Ontmoet alvast onze reisleiders!'),
        ('blog', 'campfire stories', 'Weblog', 'Lees ervaringen van onze reisleiders en deelnemers!'),
        ('faq', 'Handig om te weten!', 'Veelgestelde vragen', ''),
        ('aanmelden', 'Ja! Ik ga graag mee op reis', 'Aanmelden', 'Doorloop onderstaande stappen om je aan te melden voor de reis.');
      ALTER TABLE guides
        ADD COLUMN gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN gallery_title TEXT NOT NULL DEFAULT '',
        ADD COLUMN gallery_subtitle TEXT NOT NULL DEFAULT '';
      CREATE TABLE content_transfers (
        part TEXT PRIMARY KEY,
        done_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        summary TEXT NOT NULL DEFAULT ''
      );
    `,
};

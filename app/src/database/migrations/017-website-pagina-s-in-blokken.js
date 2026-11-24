// @ts-check
/**
 * Migratie 17: website: pagina's in blokken.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 17,
  name: "website: pagina's in blokken",
  sql: `
      -- Pagina's opbouwen uit blokken (CMS-pakket H1). blocks: de gepubliceerde blokken (JSON-lijst, zie cms/blocks.js);
      -- draft: het concept ({title, pretitle, intro, image_url, image_media_id, blocks}) of NULL als er niets openstaat;
      -- draft_version: telt bij elke wijziging van het concept op, zodat twee tabbladen elkaar niet overschrijven.
      -- managed_in_crm: in het CRM gepubliceerd, de WordPress-import laat de pagina dan staan. body_html blijft als bron
      -- van de import; de site toont alleen nog blocks.
      ALTER TABLE pages
        ADD COLUMN blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN draft JSONB,
        ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN managed_in_crm BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      -- Bestaande inhoud wordt één tekstblok met de opgeschoonde HTML uit de import.
      UPDATE pages SET blocks = jsonb_build_array(jsonb_build_object(
          'id', 'b' || substr(md5('pagina-' || id::text), 1, 12), 'type', 'tekst',
          'data', jsonb_build_object('html', body_html), 'style', '{}'::jsonb))
       WHERE body_html <> '';
      -- Elke publicatie als versie (terugzetten als concept). Versie 1 van een geïmporteerde pagina is de stand van de
      -- import, zodat die altijd terug te halen is.
      CREATE TABLE page_revisions (
        id SERIAL PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        pretitle TEXT NOT NULL DEFAULT '',
        intro TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
        note TEXT NOT NULL DEFAULT '',
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (page_id, version)
      );
    `,
};

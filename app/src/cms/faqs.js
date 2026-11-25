// @ts-check
/**
 * Veelgestelde vragen beheren (CMS-pakket I3, migratie 21): categorieën met een volgorde (`faq_categories`) en vragen
 * met een opgemaakt antwoord (`faqs`). `faqs.category` is een afgeleide kopie van de categorienaam (de site, het
 * FAQ-blok en de keuzelijst van blokken lezen die); hij wordt in dezelfde transactie bijgewerkt. Een vraag die hier is
 * gemaakt of gewijzigd krijgt `managed_in_crm`, zodat de WordPress-import hem laat staan. Elke wijziging schrijft de
 * audit in dezelfde transactie. Alle vragen met gebonden parameters.
 */
const { cleanText } = require('../media/library');
const { slugify } = require('../trips/slugs');
const { sanitizeHtml } = require('../../tools/import/sanitize');

/** Maximale lengtes en aantallen. */
const FAQ_LIMITS = { category: 120, question: 300, answer: 20_000, categories: 50, questions: 500 };

/**
 * Leest een volgorde (heel getal, mag leeg).
 * @param {string} text Ingevulde tekst.
 * @param {any} errors Fouten (wordt aangevuld).
 * @returns {number} Volgorde (0 als leeg of ongeldig).
 */
function readSortOrder(text, errors) {
  const order = text.trim();
  if (order && !/^-?\d{1,6}$/.test(order)) {
    errors.sort_order = 'Vul een heel getal in.';
    return 0;
  }
  return order ? Number(order) : 0;
}

/**
 * Leest en controleert een categorie uit een formulier. De naam mag geen `<` of `>` bevatten (het FAQ-blok kiest een
 * categorie op naam).
 * @param {any} body Ingezonden velden.
 * @returns {{values: {name: string, sortOrder: number}, errors: any}} Waarden en fouten.
 */
function validateCategoryFields(body) {
  const text = (name) => (typeof body[name] === 'string' ? body[name] : '');
  const errors = {};
  const name = cleanText(text('name'), FAQ_LIMITS.category + 1);
  if (!name) errors.name = 'Vul een naam in.';
  else if (name.length > FAQ_LIMITS.category) errors.name = `Maximaal ${FAQ_LIMITS.category} tekens.`;
  else if (/[<>]/.test(name)) errors.name = 'Gebruik geen < of >.';
  const sortOrder = readSortOrder(text('sort_order'), errors);
  return { values: { name: name.slice(0, FAQ_LIMITS.category), sortOrder }, errors };
}

/**
 * Leest en controleert een vraag uit een formulier; het antwoord gaat door `sanitizeHtml`.
 * @param {any} body Ingezonden velden.
 * @returns {{values: {question: string, categoryId: string, answerHtml: string, answerInput: string, sortOrder: number}, errors: any}} Waarden en fouten.
 */
function validateQuestionFields(body) {
  const text = (name) => (typeof body[name] === 'string' ? body[name] : '');
  const errors = {};
  const question = cleanText(text('question'), FAQ_LIMITS.question + 1);
  if (!question) errors.question = 'Vul een vraag in.';
  else if (question.length > FAQ_LIMITS.question) errors.question = `Maximaal ${FAQ_LIMITS.question} tekens.`;
  const categoryId = text('category_id').trim();
  if (!/^\d{1,9}$/.test(categoryId)) errors.category_id = 'Kies een categorie.';
  const answerInput = text('answer');
  let answerHtml = '';
  if (answerInput.length > FAQ_LIMITS.answer) errors.answer = `Maximaal ${FAQ_LIMITS.answer} tekens.`;
  else {
    answerHtml = sanitizeHtml(answerInput);
    if (!answerHtml) errors.answer = 'Vul een antwoord in.';
  }
  const sortOrder = readSortOrder(text('sort_order'), errors);
  return {
    values: { question: question.slice(0, FAQ_LIMITS.question), categoryId, answerHtml, answerInput: answerInput.slice(0, FAQ_LIMITS.answer), sortOrder },
    errors,
  };
}

/**
 * Of een id uit de URL of een formulier geldig is.
 * @param {*} id Waarde.
 * @returns {boolean} Geldig.
 */
const validId = (id) => /^\d{1,9}$/.test(String(id));

/**
 * Of een nieuwe volgorde precies dezelfde id's bevat als er zijn (geen dubbele, geen ontbrekende, geen vreemde).
 * @param {number[]} existing Id's die er zijn.
 * @param {number[]} ordered Id's in de nieuwe volgorde.
 * @returns {boolean} Waar als het dezelfde verzameling is.
 */
function sameIds(existing, ordered) {
  if (existing.length !== ordered.length || new Set(ordered).size !== ordered.length) return false;
  const known = new Set(existing);
  return ordered.every((id) => known.has(id));
}

/**
 * Maakt de functies voor de FAQ.
 * @param {{db: any}} options Database.
 * @returns {any} Functies.
 */
function createFaqs(options) {
  const { db } = options;

  /**
   * Alle categorieën (op volgorde en naam) met hun vragen (op volgorde en vraag), en vragen zonder categorie apart.
   * @returns {Promise<{categories: any[], loose: any[]}>} Categorieën met `questions`, en losse vragen.
   */
  const overview = async () => {
    const [categories, questions] = await Promise.all([
      db.query('SELECT id, name, sort_order FROM faq_categories ORDER BY sort_order, name LIMIT $1', [FAQ_LIMITS.categories * 2]),
      db.query('SELECT id, question, category, category_id, sort_order FROM faqs ORDER BY sort_order, question LIMIT $1', [FAQ_LIMITS.questions * 2]),
    ]);
    const byCategory = new Map(categories.map((category) => [category.id, { ...category, questions: [] }]));
    const loose = [];
    for (const question of questions) {
      const category = byCategory.get(question.category_id);
      if (category) category.questions.push(question);
      else loose.push(question);
    }
    return { categories: [...byCategory.values()], loose };
  };

  /**
   * Eén categorie.
   * @param {(number|string)} id Id.
   * @returns {Promise<(any|null)>} Rij met `question_count`, of null.
   */
  const getCategory = async (id) => {
    if (!validId(id)) return null;
    const [row] = await db.query(
      'SELECT c.id, c.name, c.sort_order, (SELECT count(*)::int FROM faqs f WHERE f.category_id = c.id) AS question_count FROM faq_categories c WHERE c.id = $1',
      [Number(id)],
    );
    return row || null;
  };

  /**
   * Eén vraag.
   * @param {(number|string)} id Id.
   * @returns {Promise<(any|null)>} Rij of null.
   */
  const getQuestion = async (id) => {
    if (!validId(id)) return null;
    const [row] = await db.query('SELECT id, slug, question, answer_html, category, category_id, sort_order, updated_at FROM faqs WHERE id = $1', [Number(id)]);
    return row || null;
  };

  /**
   * Maakt een categorie.
   * @param {{name: string, sortOrder: number}} values Uit `validateCategoryFields`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client, id) => Promise`).
   * @returns {Promise<{id?: number, errors?: any}>} Nieuw id of fouten.
   */
  const createCategory = (values, context) => db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['faq-categorieen']);
    const [{ count }] = await client.query('SELECT count(*)::int AS count FROM faq_categories');
    if (count >= FAQ_LIMITS.categories) return { errors: { name: `Er zijn hoogstens ${FAQ_LIMITS.categories} categorieën.` } };
    const [row] = await client.query(
      'INSERT INTO faq_categories (name, sort_order, updated_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id',
      [values.name, values.sortOrder, context.userId],
    );
    if (!row) return { errors: { name: 'Deze categorie bestaat al.' } };
    await context.audit(client, row.id);
    return { id: row.id };
  });

  /**
   * Wijzigt een categorie; een andere naam gaat mee naar de vragen (`faqs.category`).
   * @param {(number|string)} id Id.
   * @param {{name: string, sortOrder: number}} values Uit `validateCategoryFields`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'fout'), errors?: any, renamed?: boolean}>} Uitkomst.
   */
  const updateCategory = (id, values, context) => db.transaction(async (client) => {
    if (!validId(id)) return { status: 'weg' };
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['faq-categorieen']);
    const [category] = await client.query('SELECT id, name FROM faq_categories WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!category) return { status: 'weg' };
    const [other] = await client.query('SELECT id FROM faq_categories WHERE lower(name) = lower($1) AND id <> $2', [values.name, category.id]);
    if (other) return { status: 'fout', errors: { name: 'Deze categorie bestaat al.' } };
    await client.query(
      'UPDATE faq_categories SET name = $2, sort_order = $3, updated_at = now(), updated_by = $4 WHERE id = $1',
      [category.id, values.name, values.sortOrder, context.userId],
    );
    const renamed = values.name !== category.name;
    if (renamed) {
      await client.query('UPDATE faqs SET category = $2, managed_in_crm = true, updated_at = now(), updated_by = $3 WHERE category_id = $1', [category.id, values.name, context.userId]);
    }
    await context.audit(client);
    return { status: 'ok', renamed };
  });

  /**
   * Verwijdert een lege categorie.
   * @param {(number|string)} id Id.
   * @param {{audit: Function}} context Audit.
   * @returns {Promise<{status: ('ok'|'weg'|'vol')}>} Uitkomst (`vol`: er staan nog vragen in).
   */
  const removeCategory = (id, context) => db.transaction(async (client) => {
    if (!validId(id)) return { status: 'weg' };
    const [category] = await client.query('SELECT id FROM faq_categories WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!category) return { status: 'weg' };
    const [used] = await client.query('SELECT 1 AS used FROM faqs WHERE category_id = $1 LIMIT 1', [category.id]);
    if (used) return { status: 'vol' };
    await client.query('DELETE FROM faq_categories WHERE id = $1', [category.id]);
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Zoekt de gekozen categorie op en houdt die vast tot het einde van de transactie.
   * @param {any} client Databaseclient in een transactie.
   * @param {string} categoryId Gekozen id.
   * @returns {Promise<(any|null)>} Categorie of null.
   */
  const lockCategory = async (client, categoryId) => {
    const [category] = await client.query('SELECT id, name FROM faq_categories WHERE id = $1 FOR SHARE', [Number(categoryId)]);
    return category || null;
  };

  /**
   * Maakt een vraag; de slug (alleen voor oude adressen, die naar /faq/ verwijzen) komt uit de vraag en is uniek.
   * @param {any} values Uit `validateQuestionFields`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client, id) => Promise`).
   * @returns {Promise<{id?: number, errors?: any}>} Nieuw id of fouten.
   */
  const createQuestion = (values, context) => db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['faq-vragen']);
    const [{ count }] = await client.query('SELECT count(*)::int AS count FROM faqs');
    if (count >= FAQ_LIMITS.questions) return { errors: { question: `Er zijn hoogstens ${FAQ_LIMITS.questions} vragen.` } };
    const category = await lockCategory(client, values.categoryId);
    if (!category) return { errors: { category_id: 'Kies een categorie.' } };
    const base = slugify(values.question).slice(0, 80).replace(/-+$/, '') || 'vraag';
    for (let number = 1; number <= 50; number += 1) {
      const slug = number === 1 ? base : `${base}-${number}`;
      const [row] = await client.query(
        `INSERT INTO faqs (slug, question, answer_html, category, category_id, sort_order, managed_in_crm, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7) ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [slug, values.question, values.answerHtml, category.name, category.id, values.sortOrder, context.userId],
      );
      if (row) {
        await context.audit(client, row.id);
        return { id: row.id };
      }
    }
    return { errors: { question: 'Er bestaan al te veel vragen met deze tekst.' } };
  });

  /**
   * Wijzigt een vraag.
   * @param {(number|string)} id Id.
   * @param {any} values Uit `validateQuestionFields`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'fout'), errors?: any}>} Uitkomst.
   */
  const updateQuestion = (id, values, context) => db.transaction(async (client) => {
    if (!validId(id)) return { status: 'weg' };
    const [question] = await client.query('SELECT id FROM faqs WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!question) return { status: 'weg' };
    const category = await lockCategory(client, values.categoryId);
    if (!category) return { status: 'fout', errors: { category_id: 'Kies een categorie.' } };
    await client.query(
      `UPDATE faqs SET question = $2, answer_html = $3, category = $4, category_id = $5, sort_order = $6, managed_in_crm = true,
         updated_at = now(), updated_by = $7 WHERE id = $1`,
      [question.id, values.question, values.answerHtml, category.name, category.id, values.sortOrder, context.userId],
    );
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Verwijdert een vraag.
   * @param {(number|string)} id Id.
   * @param {{audit: Function}} context Audit.
   * @returns {Promise<{status: ('ok'|'weg')}>} Uitkomst.
   */
  const removeQuestion = (id, context) => db.transaction(async (client) => {
    if (!validId(id)) return { status: 'weg' };
    const [question] = await client.query('DELETE FROM faqs WHERE id = $1 RETURNING id', [Number(id)]);
    if (!question) return { status: 'weg' };
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Zet de volgorde van alle categorieën: de opgegeven id's moeten precies alle categorieën zijn. De volgorde wordt
   * 10, 20, 30, … (zoals de migratie), zodat er later iets tussen kan met het veld Volgorde.
   * @param {number[]} ids Alle id's van de categorieën, in de nieuwe volgorde.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'fout')}>} Uitkomst (`fout`: de lijst klopt niet met wat er is).
   */
  const reorderCategories = (ids, context) => db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['faq-categorieen']);
    const rows = await client.query('SELECT id FROM faq_categories ORDER BY id FOR UPDATE');
    if (!sameIds(rows.map((row) => row.id), ids)) return { status: 'fout' };
    await client.query(
      `UPDATE faq_categories c SET sort_order = n.position * 10, updated_at = now(), updated_by = $2
       FROM unnest($1::int[]) WITH ORDINALITY AS n(id, position) WHERE c.id = n.id AND c.sort_order <> n.position * 10`,
      [ids, context.userId],
    );
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Zet de volgorde van de vragen in één categorie: de opgegeven id's moeten precies de vragen van die categorie zijn.
   * @param {(number|string)} categoryId Id van de categorie.
   * @param {number[]} ids Alle id's van de vragen in die categorie, in de nieuwe volgorde.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'fout')}>} Uitkomst (`weg`: geen categorie; `fout`: de lijst klopt niet).
   */
  const reorderQuestions = (categoryId, ids, context) => db.transaction(async (client) => {
    if (!validId(categoryId)) return { status: 'weg' };
    // Zelfde volgorde van vergrendelen als `updateQuestion`: eerst de vragen, dan de categorie (geen deadlock).
    const rows = await client.query('SELECT id FROM faqs WHERE category_id = $1 ORDER BY id FOR UPDATE', [Number(categoryId)]);
    const category = await lockCategory(client, String(categoryId));
    if (!category) return { status: 'weg' };
    if (!sameIds(rows.map((row) => row.id), ids)) return { status: 'fout' };
    await client.query(
      `UPDATE faqs f SET sort_order = n.position * 10, managed_in_crm = true, updated_at = now(), updated_by = $2
       FROM unnest($1::int[]) WITH ORDINALITY AS n(id, position) WHERE f.id = n.id AND f.sort_order <> n.position * 10`,
      [ids, context.userId],
    );
    await context.audit(client);
    return { status: 'ok' };
  });

  return {
    overview, getCategory, getQuestion, createCategory, updateCategory, removeCategory, createQuestion, updateQuestion, removeQuestion,
    reorderCategories, reorderQuestions,
  };
}

module.exports = { createFaqs, validateCategoryFields, validateQuestionFields, FAQ_LIMITS };

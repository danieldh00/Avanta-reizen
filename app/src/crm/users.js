/**
 * Gebruikersbeheer en auditlog van het CRM (recht `gebruikers`): lijst, nieuwe gebruiker, rol/naam/e-mail wijzigen,
 * blokkeren, een nieuw wachtwoord instellen, de tweestapsverificatie uitzetten (toestel kwijt) en een activatiecode
 * maken waarmee de gebruiker 2FA kan instellen. De laatste actieve beheerder kan niet worden gedegradeerd of
 * geblokkeerd. Elke wijziging komt in het auditlog, zonder de waarden zelf.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { ROLES, TRIP_SCOPED_ROLES, roleLabel } = require('./rights');
const { hashPassword, passwordProblem, MAX_LENGTH } = require('./passwords');
const { renderCrmPage, renderInput, renderAlert, formatDateTime } = require('./layout');
const { PERSON_ACTION_LABELS } = require('./person-routes');
const { MERGE_ACTION_LABELS } = require('./person-merge-routes');
const { BOOKING_ACTION_LABELS } = require('./booking-routes');
const { PARTICIPANT_LIST_ACTION_LABELS } = require('./participant-list-routes');
const { MEDIA_ACTION_LABELS } = require('../media/routes');
const { CATEGORY_ACTION_LABELS } = require('../trips/category-routes');
const { TRIP_ACTION_LABELS } = require('../trips/trip-routes');
const { PAGE_ACTION_LABELS } = require('../cms/page-routes');
const { POST_ACTION_LABELS } = require('../cms/post-routes');
const { TERM_ACTION_LABELS } = require('../cms/post-term-routes');
const { FAQ_ACTION_LABELS } = require('../cms/faq-routes');
const { GUIDE_ACTION_LABELS } = require('../trips/guide-routes');
const { MENU_ACTION_LABELS } = require('../cms/menu-routes');
const { ACCOUNT_ACTION_LABELS } = require('../account/routes');
const { RETENTION_ACTION_LABELS } = require('../beheer/retention-routes');
const { PRIVACY_ACTION_LABELS } = require('./person-privacy-routes');

/** Aantal regels per pagina van het auditlog. */
const AUDIT_PAGE_SIZE = 100;

/** Omschrijving van de acties in het auditlog. */
const ACTION_LABELS = {
  inloggen: 'Ingelogd',
  'inloggen.mislukt': 'Inloggen mislukt',
  'inloggen.geblokkeerd': 'Inloggen geweigerd (te veel pogingen vanaf deze IP-reeks)',
  'inloggen.inactief': 'Inloggen geweigerd (account uitgeschakeld)',
  'inloggen.wachtwoord': 'Wachtwoord goed, wacht op tweede stap',
  'inloggen.code-mislukt': 'Inloggen: verkeerde code (tweede stap)',
  'inloggen.code-geblokkeerd': 'Inloggen geweigerd (te veel verkeerde codes)',
  'tweestaps.aan': 'Tweestapsverificatie aangezet',
  'tweestaps.uit': 'Tweestapsverificatie uitgezet',
  'tweestaps.herstelcode': 'Ingelogd met een herstelcode',
  'tweestaps.herstelcodes': 'Nieuwe herstelcodes gemaakt',
  'gebruiker.tweestaps': 'Tweestapsverificatie uitgezet door beheerder',
  'gebruiker.activatiecode': 'Activatiecode voor tweestapsverificatie gemaakt',
  'tweestaps.activatie-mislukt': 'Tweestapsverificatie: onjuiste activatiecode',
  uitloggen: 'Uitgelogd',
  installatie: 'Eerste beheerder aangemaakt',
  'installatie.mislukt': 'Installatie: onjuiste code',
  'installatie.ongeldig': 'Installatie: onvolledig formulier',
  'wachtwoord.gewijzigd': 'Eigen wachtwoord gewijzigd',
  'gebruiker.aangemaakt': 'Gebruiker aangemaakt',
  'gebruiker.gewijzigd': 'Gebruiker gewijzigd',
  'gebruiker.rol': 'Rol gewijzigd',
  'gebruiker.reisleidersprofiel': 'Reisleidersprofiel van een gebruiker gewijzigd',
  'gebruiker.uitgeschakeld': 'Gebruiker uitgeschakeld',
  'gebruiker.ingeschakeld': 'Gebruiker ingeschakeld',
  'doorverwijzing.aangemaakt': 'Doorverwijzing toegevoegd',
  'doorverwijzing.verwijderd': 'Doorverwijzing verwijderd',
  'niet-gevonden.verwijderd': 'Regel uit de 404-lijst verwijderd',
  'niet-gevonden.geleegd': '404-lijst leeggemaakt',
  'gebruiker.wachtwoord': 'Nieuw wachtwoord ingesteld door beheerder',
  'instelling.gewijzigd': 'Instelling gewijzigd',
  'instelling.teruggezet': 'Instelling teruggezet naar de startwaarde',
  ...PERSON_ACTION_LABELS,
  ...MERGE_ACTION_LABELS,
  ...BOOKING_ACTION_LABELS,
  ...PARTICIPANT_LIST_ACTION_LABELS,
  ...MEDIA_ACTION_LABELS,
  ...CATEGORY_ACTION_LABELS,
  ...TRIP_ACTION_LABELS,
  ...PAGE_ACTION_LABELS,
  ...POST_ACTION_LABELS,
  ...TERM_ACTION_LABELS,
  ...FAQ_ACTION_LABELS,
  ...GUIDE_ACTION_LABELS,
  ...MENU_ACTION_LABELS,
  ...ACCOUNT_ACTION_LABELS,
  ...RETENTION_ACTION_LABELS,
  ...PRIVACY_ACTION_LABELS,
};

/**
 * Maakt de routes voor gebruikersbeheer en het auditlog.
 * @param {{db: object, auth: object, twoFactor: object, normalizeEmail: Function, textField: Function}} options Database,
 *   sessie- en rechtenlaag, de 2FA-opslag (`crm/two-factor.js`) en de invoerhulpen uit `crm/routes.js`.
 * @returns {express.Router} Router.
 */
function createUserRoutes(options) {
  const { db, auth, twoFactor, normalizeEmail, textField } = options;
  const router = express.Router();
  const guard = auth.requireRight('gebruikers');

  /**
   * Leest de velden van het gebruikersformulier en controleert ze.
   * @param {object} body Ingezonden velden.
   * @param {{withPassword: boolean}} mode Of er een wachtwoord bij hoort (nieuwe gebruiker).
   * @returns {{values: object, errors: object}} Waarden en fouten per veld.
   */
  const readUserForm = (body, mode) => {
    const values = {
      name: textField(body.name, 100),
      email: textField(body.email, 200),
      role: Object.hasOwn(ROLES, body.role) ? body.role : '',
      active: body.active === 'ja',
      // Alleen een reisleider hangt aan een reisleidersprofiel (eigen vertrekken via trip_guides).
      guide_id: TRIP_SCOPED_ROLES.includes(body.role) && /^\d{1,9}$/.test(String(body.guide_id || '')) ? Number(body.guide_id) : null,
    };
    const errors = {};
    if (!values.name) errors.name = 'Vul een naam in.';
    const email = normalizeEmail(body.email);
    if (!email) errors.email = 'Vul een geldig e-mailadres in.';
    else values.email = email;
    if (!values.role) errors.role = 'Kies een rol.';
    if (mode.withPassword) {
      const problem = passwordProblem(body.password, { email });
      if (problem) errors.password = problem;
    }
    return { values, errors };
  };

  /**
   * Keuzelijst voor de rol.
   * @param {string} selected Gekozen rol.
   * @param {string} [error] Foutmelding.
   * @returns {object} HTML.
   */
  const renderRoleSelect = (selected, error) => html`<div class="field">
    <span class="field__label"><label for="veld-role">Rol</label></span>
    <select id="veld-role" name="role" required>
      <option value="">Kies een rol</option>
      ${Object.entries(ROLES).map(([key, role]) => html`<option value="${key}"${key === selected ? raw(' selected') : ''}>${role.label}</option>`)}
    </select>
    ${error ? html`<span class="field__error">${error}</span>` : ''}
  </div>`;

  /**
   * De reisleidersprofielen voor de keuzelijst.
   * @returns {Promise<Array<{id: number, name: string}>>} Profielen op naam.
   */
  const loadGuides = () => db.query('SELECT id, name FROM guides ORDER BY lower(name), id');

  /**
   * Keuzelijst voor het reisleidersprofiel (alleen voor de rol reisleider van belang).
   * @param {(number|null)} selected Gekozen profiel.
   * @param {Array<{id: number, name: string}>} guides Profielen.
   * @param {string} [error] Foutmelding.
   * @returns {object} HTML.
   */
  const renderGuideSelect = (selected, guides, error) => html`<div class="field">
    <span class="field__label"><label for="veld-guide">Reisleidersprofiel (alleen bij rol Reisleider)</label></span>
    <select id="veld-guide" name="guide_id">
      <option value="">Geen</option>
      ${guides.map((guide) => html`<option value="${guide.id}"${guide.id === selected ? raw(' selected') : ''}>${guide.name}</option>`)}
    </select>
    <span class="field__help">De reisleider ziet alleen de deelnemerslijsten van vertrekken waar dit profiel aan hangt.</span>
    ${error ? html`<span class="field__error">${error}</span>` : ''}
  </div>`;

  /**
   * Of een gekozen reisleidersprofiel bestaat (leeg mag altijd).
   * @param {(number|null)} guideId Gekozen profiel.
   * @returns {Promise<boolean>} Waar als leeg of bestaand.
   */
  const guideExists = async (guideId) => guideId === null || (await db.query('SELECT 1 FROM guides WHERE id = $1', [guideId])).length > 0;

  /**
   * Zoekt een gebruiker op id.
   * @param {string} id Id uit de URL (alleen cijfers, zie de route).
   * @returns {Promise<(object|null)>} Gebruiker, of null.
   */
  const findUser = async (id) => {
    const [user] = await db.query(
      'SELECT id, email, name, role, active, guide_id, last_login_at, (totp_enabled_at IS NOT NULL) AS mfa_enabled FROM users WHERE id = $1',
      [Number(id)],
    );
    return user || null;
  };

  /**
   * 404-pagina binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderCrmPage({
    title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, body: html`<p>Deze gebruiker bestaat niet. <a href="/app/gebruikers/">Naar de gebruikers</a></p>`,
  }));

  /**
   * Of de wijziging de laatste actieve beheerder zou degraderen of blokkeren. Draait in een transactie met slot.
   * @param {{query: Function}} client Transactie-client.
   * @param {object} current Huidige gebruiker.
   * @param {{role: string, active: boolean}} next Nieuwe rol en status.
   * @returns {Promise<boolean>} Waar als de wijziging niet mag.
   */
  const removesLastAdmin = async (client, current, next) => {
    if (current.role !== 'beheerder' || !current.active || (next.role === 'beheerder' && next.active)) return false;
    const [row] = await client.query("SELECT count(*)::int AS admins FROM users WHERE role = 'beheerder' AND active AND id <> $1", [current.id]);
    return row.admins === 0;
  };

  router.get('/gebruikers/', guard, async (req, res, next) => {
    try {
      const users = await db.query(
        'SELECT id, email, name, role, active, last_login_at, (totp_enabled_at IS NOT NULL) AS mfa_enabled FROM users ORDER BY active DESC, lower(name), id',
      );
      return res.send(renderCrmPage({
        title: 'Gebruikers',
        user: req.user,
        csrf: req.session.csrf,
        path: '/app/gebruikers/',
        body: html`${req.query.opgeslagen === '1' ? html`<p class="notice" role="status">De gebruiker is opgeslagen.</p>` : ''}
          <p><a class="btn" href="/app/gebruikers/nieuw/">Nieuwe gebruiker</a></p>
          <div class="crm-table-wrap"><table class="crm-table">
            <thead><tr><th scope="col">Naam</th><th scope="col">E-mailadres</th><th scope="col">Rol</th><th scope="col">Status</th><th scope="col">Tweestaps</th><th scope="col">Laatst ingelogd</th></tr></thead>
            <tbody>${users.map((user) => html`<tr>
              <td><a href="/app/gebruikers/${user.id}/">${user.name}</a></td>
              <td>${user.email}</td>
              <td>${roleLabel(user.role)}</td>
              <td>${user.active ? 'Actief' : 'Uitgeschakeld'}</td>
              <td>${user.mfa_enabled ? 'Aan' : 'Uit'}</td>
              <td>${formatDateTime(user.last_login_at)}</td>
            </tr>`)}</tbody>
          </table></div>`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Het formulier voor een nieuwe gebruiker.
   * @param {object} req Express-verzoek.
   * @param {{values?: object, errors?: object}} state Waarden en fouten.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderNewUser = async (req, state = {}) => {
    const values = state.values || {};
    const errors = state.errors || {};
    const guides = await loadGuides();
    return renderCrmPage({
      title: 'Nieuwe gebruiker',
      user: req.user,
      csrf: req.session.csrf,
      body: html`<div class="crm-narrow">
        ${renderAlert(errors._form)}
        <form class="form" method="post" action="/app/gebruikers/nieuw/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          ${renderInput({ name: 'name', label: 'Naam', value: values.name, error: errors.name, max: 100, autocomplete: 'off' })}
          ${renderInput({ name: 'email', label: 'E-mailadres', type: 'email', value: values.email, error: errors.email, max: 200, autocomplete: 'off' })}
          ${renderRoleSelect(values.role, errors.role)}
          ${renderGuideSelect(values.guide_id ?? null, guides, errors.guide_id)}
          ${renderInput({ name: 'password', label: 'Startwachtwoord (minimaal 12 tekens)', type: 'password', error: errors.password, max: MAX_LENGTH, autocomplete: 'new-password' })}
          <p class="field__help">Geef het startwachtwoord persoonlijk door; de gebruiker kan het daarna zelf wijzigen.</p>
          <div><button class="btn" type="submit">Gebruiker aanmaken</button> <a href="/app/gebruikers/">Annuleren</a></div>
        </form>
      </div>`,
    });
  };

  router.get('/gebruikers/nieuw/', guard, async (req, res, next) => {
    try {
      return res.send(await renderNewUser(req));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/gebruikers/nieuw/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, errors } = readUserForm(req.body, { withPassword: true });
      if (!(await guideExists(values.guide_id))) errors.guide_id = 'Dit reisleidersprofiel bestaat niet.';
      if (Object.keys(errors).length) return res.status(422).send(await renderNewUser(req, { values, errors }));
      const passwordHash = await hashPassword(req.body.password);
      try {
        await db.transaction(async (client) => {
          const [user] = await client.query(
            'INSERT INTO users (email, name, role, password_hash, guide_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [values.email, values.name, values.role, passwordHash, values.guide_id],
          );
          await auth.audit(req, { userId: req.user.id, action: 'gebruiker.aangemaakt', entity: 'users', entityId: user.id }, client);
        });
      } catch (error) {
        if (error.code === '23503') return res.status(422).send(await renderNewUser(req, { values, errors: { guide_id: 'Dit reisleidersprofiel bestaat niet.' } }));
        if (error.code !== '23505') throw error;
        return res.status(422).send(await renderNewUser(req, { values, errors: { email: 'Er is al een gebruiker met dit e-mailadres.' } }));
      }
      return res.redirect(303, '/app/gebruikers/?opgeslagen=1');
    } catch (error) {
      return next(error);
    }
  });

  /**
   * De pagina van één gebruiker: gegevens wijzigen en een nieuw wachtwoord instellen.
   * @param {object} req Express-verzoek.
   * @param {object} target De gebruiker.
   * @param {{values?: object, errors?: object, passwordErrors?: object, notice?: string, activationCode?: string, activationUntil?: (Date|null)}} state
 *   Waarden, fouten, melding, een zojuist gemaakte activatiecode (één keer tonen) en tot wanneer een bestaande code geldt.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderEditUser = async (req, target, state = {}) => {
    const values = state.values || target;
    const guides = await loadGuides();
    const errors = state.errors || {};
    const passwordErrors = state.passwordErrors || {};
    return renderCrmPage({
      title: target.name,
      user: req.user,
      csrf: req.session.csrf,
      body: html`<div class="crm-narrow">
        <p><a href="/app/gebruikers/">Naar de gebruikers</a> · Laatst ingelogd: ${formatDateTime(target.last_login_at)}</p>
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(errors._form)}
        <form class="form" method="post" action="/app/gebruikers/${target.id}/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          ${renderInput({ name: 'name', label: 'Naam', value: values.name, error: errors.name, max: 100, autocomplete: 'off' })}
          ${renderInput({ name: 'email', label: 'E-mailadres', type: 'email', value: values.email, error: errors.email, max: 200, autocomplete: 'off' })}
          ${renderRoleSelect(values.role, errors.role)}
          ${renderGuideSelect(values.guide_id ?? null, guides, errors.guide_id)}
          <label class="choice"><input type="checkbox" name="active" value="ja"${values.active ? raw(' checked') : ''}> <span>Account actief (uitzetten logt de gebruiker overal uit)</span></label>
          <div><button class="btn" type="submit">Opslaan</button></div>
        </form>
        <h2>Nieuw wachtwoord instellen</h2>
        ${renderAlert(passwordErrors._form)}
        <form class="form" method="post" action="/app/gebruikers/${target.id}/wachtwoord/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          ${renderInput({ name: 'password', label: 'Nieuw wachtwoord (minimaal 12 tekens)', type: 'password', error: passwordErrors.password, max: MAX_LENGTH, autocomplete: 'new-password' })}
          <p class="field__help">Logt de gebruiker overal uit.</p>
          <div><button class="btn btn--outline" type="submit">Wachtwoord instellen</button></div>
        </form>
        <h2>Tweestapsverificatie</h2>
        ${target.mfa_enabled
    ? html`<p>Staat aan. Is de gebruiker zijn telefoon én herstelcodes kwijt, zet het dan hier uit. De gebruiker wordt overal
          uitgelogd en stelt het bij de volgende keer inloggen opnieuw in (als het verplicht is).</p>
        <form method="post" action="/app/gebruikers/${target.id}/tweestaps/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <button class="btn btn--outline" type="submit">Tweestapsverificatie uitzetten</button>
        </form>`
    : html`<p>Staat uit${auth.mfaRequiredFor(target.role) ? '; de gebruiker stelt het in bij de volgende keer inloggen' : ' (optioneel voor deze gebruiker)'}.
          Daarvoor is een activatiecode nodig: maak die hier en geef hem persoonlijk door (niet in dezelfde mail als het
          wachtwoord). Zo is het wachtwoord alleen nooit genoeg om een eigen app te koppelen.</p>
        ${state.activationCode
    ? html`<p class="notice" role="status">Activatiecode: <code class="crm-secret">${state.activationCode}</code><br>Geldig tot
          ${formatDateTime(state.activationUntil)}. Deze code wordt niet nog eens getoond.</p>`
    : html`${state.activationUntil ? html`<p>Er staat een activatiecode klaar, geldig tot ${formatDateTime(state.activationUntil)}. Een nieuwe code vervangt die.</p>` : ''}`}
        <form method="post" action="/app/gebruikers/${target.id}/activatiecode/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <button class="btn btn--outline" type="submit">Activatiecode maken</button>
        </form>`}
      </div>`,
    });
  };

  router.get('/gebruikers/:id(\\d{1,9})/', guard, async (req, res, next) => {
    try {
      const target = await findUser(req.params.id);
      if (!target) return notFound(req, res);
      let notice = '';
      if (req.query.wachtwoord === '1') notice = 'Het nieuwe wachtwoord is ingesteld.';
      else if (req.query.tweestaps === '1') notice = 'De tweestapsverificatie is uitgezet en de gebruiker is overal uitgelogd.';
      return res.send(await renderEditUser(req, target, { notice, activationUntil: target.mfa_enabled ? null : await twoFactor.activationUntil(target.id) }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/gebruikers/:id(\\d{1,9})/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, errors } = readUserForm(req.body, { withPassword: false });
      const target = await findUser(req.params.id);
      if (!target) return notFound(req, res);
      if (!(await guideExists(values.guide_id))) errors.guide_id = 'Dit reisleidersprofiel bestaat niet.';
      if (Object.keys(errors).length) return res.status(422).send(await renderEditUser(req, target, { values, errors }));
      let outcome;
      try {
        outcome = await db.transaction(async (client) => {
          // Slot zodat twee beheerders niet tegelijk de laatste beheerder kunnen weghalen.
          await client.query('SELECT pg_advisory_xact_lock(727003)');
          const [current] = await client.query('SELECT id, role, active, guide_id FROM users WHERE id = $1 FOR UPDATE', [target.id]);
          if (!current) return 'weg';
          if (await removesLastAdmin(client, current, values)) return 'laatste-beheerder';
          await client.query(
            'UPDATE users SET name = $2, email = $3, role = $4, active = $5, guide_id = $6, updated_at = now() WHERE id = $1',
            [target.id, values.name, values.email, values.role, values.active, values.guide_id],
          );
          const actions = ['gebruiker.gewijzigd'];
          if (current.role !== values.role) actions.push('gebruiker.rol');
          if (current.guide_id !== values.guide_id) actions.push('gebruiker.reisleidersprofiel');
          if (current.active !== values.active) actions.push(values.active ? 'gebruiker.ingeschakeld' : 'gebruiker.uitgeschakeld');
          if (!values.active || current.role !== values.role) {
            await auth.endSessionsOf(target.id, target.id === req.user.id ? req.session.tokenHash : '', client);
          }
          for (const action of actions) await auth.audit(req, { userId: req.user.id, action, entity: 'users', entityId: target.id }, client);
          return 'ok';
        });
      } catch (error) {
        if (error.code === '23503') return res.status(422).send(await renderEditUser(req, target, { values, errors: { guide_id: 'Dit reisleidersprofiel bestaat niet.' } }));
        if (error.code !== '23505') throw error;
        return res.status(422).send(await renderEditUser(req, target, { values, errors: { email: 'Er is al een gebruiker met dit e-mailadres.' } }));
      }
      if (outcome === 'weg') return notFound(req, res);
      if (outcome === 'laatste-beheerder') {
        return res.status(422).send(await renderEditUser(req, target, { values, errors: { _form: 'Er moet minstens één actieve beheerder blijven. Maak eerst iemand anders beheerder.' } }));
      }
      return res.redirect(303, '/app/gebruikers/?opgeslagen=1');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/gebruikers/:id(\\d{1,9})/wachtwoord/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const target = await findUser(req.params.id);
      if (!target) return notFound(req, res);
      const problem = passwordProblem(req.body.password, { email: target.email });
      if (problem) return res.status(422).send(await renderEditUser(req, target, { passwordErrors: { password: problem } }));
      const passwordHash = await hashPassword(req.body.password);
      await db.transaction(async (client) => {
        await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [target.id, passwordHash]);
        await auth.endSessionsOf(target.id, target.id === req.user.id ? req.session.tokenHash : '', client);
        await auth.audit(req, { userId: req.user.id, action: 'gebruiker.wachtwoord', entity: 'users', entityId: target.id }, client);
      });
      return res.redirect(303, `/app/gebruikers/${target.id}/?wachtwoord=1`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/gebruikers/:id(\\d{1,9})/tweestaps/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const target = await findUser(req.params.id);
      if (!target) return notFound(req, res);
      await db.transaction(async (client) => {
        if (!(await twoFactor.disable(target.id, client))) return;
        // Ook de eigen andere sessies: wie zijn eigen 2FA zo uitzet, houdt alleen de huidige sessie.
        await auth.endSessionsOf(target.id, target.id === req.user.id ? req.session.tokenHash : '', client);
        await auth.audit(req, { userId: req.user.id, action: 'gebruiker.tweestaps', entity: 'users', entityId: target.id }, client);
      });
      return res.redirect(303, `/app/gebruikers/${target.id}/?tweestaps=1`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/gebruikers/:id(\\d{1,9})/activatiecode/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const target = await findUser(req.params.id);
      if (!target) return notFound(req, res);
      if (target.mfa_enabled) return res.redirect(303, `/app/gebruikers/${target.id}/`);
      const code = await db.transaction(async (client) => {
        const created = await twoFactor.issueActivation(target.id, client);
        await auth.audit(req, { userId: req.user.id, action: 'gebruiker.activatiecode', entity: 'users', entityId: target.id }, client);
        return created;
      });
      return res.send(await renderEditUser(req, target, { activationCode: code, activationUntil: await twoFactor.activationUntil(target.id) }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/auditlog/', guard, async (req, res, next) => {
    try {
      const before = /^\d{1,18}$/.test(String(req.query.voor || '')) ? String(req.query.voor) : null;
      const rows = await db.query(
        `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.ip_prefix, u.name AS user_name
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
          WHERE ($1::bigint IS NULL OR a.id < $1::bigint)
          ORDER BY a.id DESC
          LIMIT $2`,
        [before, AUDIT_PAGE_SIZE + 1],
      );
      const page = rows.slice(0, AUDIT_PAGE_SIZE);
      const older = rows.length > AUDIT_PAGE_SIZE ? page[page.length - 1].id : null;
      return res.send(renderCrmPage({
        title: 'Auditlog',
        user: req.user,
        csrf: req.session.csrf,
        path: '/app/auditlog/',
        body: html`<p>Wie wat deed en wanneer. Waarden en persoonsgegevens worden nooit gelogd; het IP-adres alleen ingekort.</p>
          <div class="crm-table-wrap"><table class="crm-table">
            <thead><tr><th scope="col">Tijdstip</th><th scope="col">Gebruiker</th><th scope="col">Actie</th><th scope="col">Record</th><th scope="col">IP-reeks</th></tr></thead>
            <tbody>${page.map((row) => html`<tr>
              <td>${formatDateTime(row.created_at)}</td>
              <td>${row.user_name || '–'}</td>
              <td>${ACTION_LABELS[row.action] || row.action}</td>
              <td>${row.entity ? `${row.entity} #${row.entity_id}` : '–'}</td>
              <td>${row.ip_prefix || '–'}</td>
            </tr>`)}</tbody>
          </table></div>
          ${older ? html`<p><a href="/app/auditlog/?voor=${older}">Oudere regels</a></p>` : ''}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createUserRoutes, ACTION_LABELS, AUDIT_PAGE_SIZE };

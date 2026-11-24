/**
 * Design-controle: inloggen als CRM-beheerder of als reiziger in een Playwright-context, gedeeld door `check.js` en
 * `overview.js`. Eerst via het echte formulier in de browser; lukt dat niet, dan via een los verzoek met een correcte
 * Origin-kop, zodat de controle de schermen achter de login toch kan bekijken. Het resultaat zegt welke weg werkte, zodat
 * een kapot inlogformulier zelf als bevinding zichtbaar wordt.
 */
const { accounts } = require('./credentials');

/** Inlogschermen per soort gebruiker (sleutel uit `accounts()`), met het scherm dat na een geslaagde login volgt. */
const LOGINS = {
  crm: { path: '/app/inloggen/', account: 'ADMIN', landing: /\/app\/(?!inloggen)/ },
  customer: { path: '/account/inloggen/', account: 'CUSTOMER', landing: /\/account\/(?!inloggen)/ },
};

/**
 * Logt een context in.
 * @param {object} context Playwright-context.
 * @param {('crm'|'customer')} kind Soort gebruiker.
 * @param {string} baseUrl Basisadres van de app.
 * @returns {Promise<{viaForm: boolean, formStatus: number}>} Of het formulier in de browser werkte, en zijn HTTP-status.
 */
async function login(context, kind, baseUrl) {
  const { path, account, landing } = LOGINS[kind];
  // Leest het wachtwoord pas hier, en maakt het nooit aan: zonder seed.js volgt een duidelijke melding.
  const user = accounts()[account];
  const page = await context.newPage();
  let formStatus;
  try {
    await page.goto(`${baseUrl}${path}`);
    const form = page.locator(`form[action$="${path}"]`);
    await form.locator('[name=email]').fill(user.email);
    await form.locator('[name=password]').fill(user.password);
    const [response] = await Promise.all([page.waitForNavigation(), form.locator('button[type=submit]').click()]);
    formStatus = response ? response.status() : 0;
    if (landing.test(new URL(page.url()).pathname)) return { viaForm: true, formStatus };
  } finally {
    await page.close();
  }
  // Terugval: hetzelfde formulier als los verzoek, met de Origin die een browser normaal meestuurt.
  await context.request.post(`${baseUrl}${path}`, { form: { email: user.email, password: user.password }, headers: { origin: new URL(baseUrl).origin }, maxRedirects: 0 });
  return { viaForm: false, formStatus };
}

module.exports = { login };

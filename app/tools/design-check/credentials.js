/**
 * Inloggegevens voor de design-controle. Alleen voor een lokale testdatabase met fictieve gegevens; nooit gebruiken op
 * een omgeving met echte gegevens (daar bestaan deze accounts niet).
 */
const PASSWORD = 'design-controle-lokaal-2026';

module.exports = {
  /** Eerste beheerder (installatiescherm). */
  ADMIN: { name: 'Design Beheerder', email: 'beheer@example.nl', password: PASSWORD },
  /** Reizigersaccount, met hetzelfde e-mailadres als de eerste aanmelding. */
  CUSTOMER: { email: 'anna@example.nl', password: PASSWORD },
  /** Extra CRM-gebruikers per rol, om de lijst Gebruikers en het menu per rol te vullen. */
  ROLE_USERS: [
    { email: 'kantoor@example.nl', name: 'Karin Kantoor', role: 'kantoor' },
    { email: 'redacteur@example.nl', name: 'Ruben Redacteur', role: 'redacteur' },
    { email: 'boekhouding@example.nl', name: 'Bert Boekhouding', role: 'boekhouding' },
  ],
};

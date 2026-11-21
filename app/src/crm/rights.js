/**
 * Rollen en rechten van het CRM (zie `docs/OPZET-CRM.md` §4). Rechten zijn losse sleutels, rollen vaste bundels.
 * De server controleert elk verzoek met `requireRight(recht)` (in `crm/auth.js`); de HTML verbergt alleen.
 * Voor de rol reisleider gelden de rechten later alleen voor de eigen vertrekken; die beperking zit in de query zelf.
 */

/** Alle rechten met een omschrijving voor het scherm. */
const RIGHTS = {
  gebruikers: 'Gebruikers, rollen en auditlog beheren',
  systeem: 'Technisch beheer: instellingen, vindbaarheid en systeem',
  reizen: 'Reizen aanmaken, wijzigen en publiceren',
  aanmeldingen: 'Aanmeldingen inzien en status wijzigen',
  deelnemers: 'Deelnemers (NAW en contact) inzien en samenvoegen',
  'gegevens.identiteit': 'Paspoort- en identiteitsgegevens inzien',
  'gegevens.gezondheid': 'Medische gegevens en noodnummer inzien',
  'gegevens.religie': 'Kerkgenootschap inzien',
  betalingen: 'Betalingen afboeken',
  facturen: 'Facturen en export naar de boekhouding',
  'export.deelnemers': 'Deelnemerslijsten exporteren (.xlsx)',
  kpis: 'Dashboard met kengetallen',
};

/** De rollen: naam voor het scherm en de rechten die erbij horen. */
const ROLES = {
  beheerder: { label: 'Beheerder', rights: Object.keys(RIGHTS) },
  kantoor: {
    label: 'Kantoor',
    rights: ['reizen', 'aanmeldingen', 'deelnemers', 'gegevens.identiteit', 'gegevens.gezondheid', 'betalingen', 'export.deelnemers', 'kpis'],
  },
  reisleider: {
    label: 'Reisleider',
    rights: ['aanmeldingen', 'deelnemers', 'gegevens.identiteit', 'gegevens.gezondheid', 'export.deelnemers'],
  },
  boekhouding: { label: 'Boekhouding', rights: ['deelnemers', 'betalingen', 'facturen', 'kpis'] },
};

/**
 * Of een rol een recht heeft. Een onbekende rol of onbekend recht geeft altijd false.
 * @param {string} role Rol van de gebruiker.
 * @param {string} right Gevraagd recht.
 * @returns {boolean} Waar als de rol het recht heeft.
 */
function roleHasRight(role, right) {
  return Object.hasOwn(ROLES, role) && Object.hasOwn(RIGHTS, right) && ROLES[role].rights.includes(right);
}

/**
 * Of een rol een recht op bijzondere of identiteitsgegevens heeft (dan is 2FA verplicht als Beheer dat voor deze rollen instelt).
 * @param {string} role Rol.
 * @returns {boolean} Waar als de rol een `gegevens.*`-recht heeft.
 */
function roleNeedsMfa(role) {
  return Object.hasOwn(ROLES, role) && ROLES[role].rights.some((right) => right.startsWith('gegevens.'));
}

/**
 * De naam van een rol voor het scherm.
 * @param {string} role Rol.
 * @returns {string} Naam, of de rol zelf als hij onbekend is.
 */
function roleLabel(role) {
  return Object.hasOwn(ROLES, role) ? ROLES[role].label : role;
}

module.exports = { RIGHTS, ROLES, roleHasRight, roleNeedsMfa, roleLabel };

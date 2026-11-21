---
titel: Aanmeldingen in het CRM (migratie 11)
bump: minor
---

## Nieuws
- In het CRM staat nu het scherm *Aanmeldingen*: alle aanmeldingen met filter op status en reis. Per aanmelding zet
  kantoor de status (nieuw, bevestigd, aanbetaald, betaald of geannuleerd met reden) en voegt notities toe; de
  historie laat zien wie wat wanneer deed.

## Changelog
- Migratie 11: `bookings.confirmed_at`, `cancelled_at`, `cancel_reason`, `status_changed_at`, CHECK op de status en
  index `(status, created_at)`; tabel `booking_events` (van/naar-status, gebruiker, notitie).
- `crm/booking-routes.js`: `GET /app/aanmeldingen/` (filters status, reis, zoeken; 50 per pagina), `GET …/:id/`,
  `POST …/:id/status/` (vaste overgangen, rij `FOR UPDATE`, verouderd formulier → 409, annuleren alleen met reden),
  `POST …/:id/notitie/`; recht `aanmeldingen`, reisleider tot de eigen-vertrekbeperking 403. Audit
  `aanmelding.status` en `aanmelding.notitie`, zonder de notitie zelf.
- Menu en overzicht: *Aanmeldingen*; op de deelnemerspagina linkt de referentie naar de aanmelding.
- CSS: statuslabel, historie; `.crm-facts` met vaste kolomverhouding (lange labels lopen niet meer buiten beeld op 375 px).

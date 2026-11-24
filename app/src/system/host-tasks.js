// @ts-check
/**
 * Servertaken (Beheer > Systeem > Servertaken): dingen die op apps01 of de
 * Proxmox-host moeten gebeuren en die de app en de automatische update zelf niet kunnen doen. De lijst staat hier in
 * de repo (`HOST_TASKS`): een PR die een hosttaak vereist, voegt er één regel aan toe én een functie
 * `hosttask_<id>` in `deploy/apps01/servertaken.sh` (een test bewaakt dat beide lijsten gelijk blijven).
 *
 * Daniël krijgt nooit losse servercommando's: er is één vast commando (`HOST_COMMAND`) voor de Proxmox-host dat alle
 * openstaande taken uitvoert, op een vaste commit van `main`.
 *
 * Afvinken gebeurt op twee manieren:
 * - automatisch: het hostscript zet na elke gelukte taak de id in `host-tasks.json` in de statusmap
 *   (`UPDATE_STATUS_DIR`, alleen-lezen in de container; de app saneert wat ze leest);
 * - met de hand in Beheer (instelling `hostTasksDone`, met wie en wanneer in het auditlog).
 */
const { readJsonFile, cleanTime } = require('./system-update');

/**
 * Eén vast commando voor de Proxmox-host (als root): haalt de nieuwste commit van main op, pint het script op die
 * exacte commit (nooit een branch) en zet het in een eigen tijdelijk bestand dat daarna wordt opgeruimd.
 */
const HOST_COMMAND = [
  "REF=$(curl -fsSL -H 'Accept: application/vnd.github.sha' https://api.github.com/repos/danieldh00/Avanta-reizen/commits/main)",
  '&& T=$(mktemp) && trap \'rm -f "$T"\' EXIT',
  '&& curl -fsSL "https://raw.githubusercontent.com/danieldh00/Avanta-reizen/$REF/deploy/apps01/servertaken.sh" -o "$T"',
  '&& TASKS_REF="$REF" bash "$T" openstaand',
].join(' ');

/**
 * Alle servertaken, oudste eerst. Een nieuwe taak komt onderaan met een nieuwe id; een bestaande id verandert nooit
 * (de id is wat het hostscript als gedaan onthoudt).
 */
const HOST_TASKS = [
  {
    id: '001-updaten-vanuit-app-inrichten',
    title: 'Updaten vanuit de app controleren',
    description: 'Werkt de testomgeving bij naar de nieuwste versie en controleert dat de mappen en de systemd-units voor "Nu updaten" en de onderhoudsmodus bestaan. Normaal regelt de automatische update dit al zelf; deze taak is de controle daarop.',
    addedAt: '2026-11-20',
  },
];

/** Formaat van een taak-id. */
const TASK_ID = /^[0-9]{3}-[a-z0-9-]{1,80}$/;

/**
 * Leest de handmatig afgevinkte taken uit de instelling (komma-gescheiden id's).
 * @param {*} value Waarde van `hostTasksDone`.
 * @returns {Set<string>} De id's.
 */
function parseDone(value) {
  return new Set(String(value || '').split(',').map((id) => id.trim()).filter((id) => TASK_ID.test(id)));
}

/**
 * Maakt de servertakenlaag.
 * @param {{statusDir?: string, settings: any, tasks?: any[]}} options De statusmap van de host (leeg = niet
 *   ingericht: dan kan de host niets afvinken), de instellingen en (voor tests) een eigen lijst.
 * @returns {{view: Function, checkedValue: Function, known: Function, command: string}} De laag.
 */
function createHostTasks({ statusDir = '', settings, tasks = HOST_TASKS }) {
  /**
   * De lijst met taken en hun stand.
   * @returns {{command: string, checkedAt: (string|null), pending: number, tasks: any[]}} De weergave.
   */
  function view() {
    const ledger = statusDir ? readJsonFile(statusDir, 'host-tasks.json') : null;
    const hostDone = ledger && ledger.done && typeof ledger.done === 'object' && !Array.isArray(ledger.done) ? ledger.done : {};
    const manual = parseDone(settings.get('hostTasksDone'));
    const list = tasks.map((task) => {
      const hostAt = cleanTime(hostDone[task.id]);
      const by = hostAt ? 'server' : manual.has(task.id) ? 'handmatig' : null;
      return { ...task, done: Boolean(by), doneAt: hostAt, doneBy: by };
    });
    return { command: HOST_COMMAND, checkedAt: ledger ? cleanTime(ledger.checkedAt) : null, pending: list.filter((task) => !task.done).length, tasks: list };
  }

  /**
   * De nieuwe waarde van `hostTasksDone` na met de hand af- of openzetten.
   * @param {string} id Id van de taak.
   * @param {boolean} done true = afvinken, false = weer openzetten.
   * @returns {string} De nieuwe waarde (alleen bekende id's, in de volgorde van de lijst).
   */
  function checkedValue(id, done) {
    const manual = parseDone(settings.get('hostTasksDone'));
    if (done) manual.add(id);
    else manual.delete(id);
    return tasks.filter((task) => manual.has(task.id)).map((task) => task.id).join(',');
  }

  return { view, checkedValue, known: (id) => tasks.some((task) => task.id === id), command: HOST_COMMAND };
}

module.exports = { createHostTasks, parseDone, HOST_TASKS, HOST_COMMAND, TASK_ID };

/**
 * Tests voor de verdeling van de instellingen over de groepen van Beheer (`beheer/instellingen/`), zonder database:
 * elke instelling staat in precies één groep en elke sectie verwijst alleen naar instellingen van haar eigen groep.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SETTING_GROUPS, mergeFields } = require('../src/beheer/instellingen');
const { SETTING_FIELDS } = require('../src/beheer/settings');
const { GROUPS } = require('../src/beheer/indeling');

test('instellingen: alle groepen samen zijn SETTING_FIELDS en GROUPS, in de volgorde van de zijbalk', () => {
  assert.deepEqual(GROUPS.map((group) => group.title), ['Systeem', 'Organisatie', 'E-mail', 'CRM', 'Toegang en beveiliging', 'Back-ups en herstel', 'Vindbaarheid']);
  assert.deepEqual(GROUPS, SETTING_GROUPS.map((group) => group.GROUP));
  const total = SETTING_GROUPS.reduce((count, group) => count + Object.keys(group.FIELDS).length, 0);
  assert.equal(Object.keys(SETTING_FIELDS).length, total);
  assert.ok(total >= 91);
});

test('instellingen: een sectie noemt alleen instellingen uit het bestand van haar eigen groep', () => {
  for (const group of SETTING_GROUPS) {
    for (const section of group.GROUP.sections) {
      for (const key of section.fields || []) {
        assert.ok(Object.hasOwn(group.FIELDS, key), `${key} in sectie ${section.id} hoort in de groep ${group.GROUP.title}`);
      }
    }
  }
});

test('instellingen: dezelfde naam in twee groepen wordt geweigerd', () => {
  assert.deepEqual(mergeFields([{ eerste: { type: 'bool' } }, { tweede: { type: 'int' } }]), { eerste: { type: 'bool' }, tweede: { type: 'int' } });
  assert.throws(() => mergeFields([{ dubbel: { type: 'bool' } }, { dubbel: { type: 'int' } }]), /dubbel staat in twee groepen/);
});

<!--
  Overzicht van de bouwstenen van de frontend (Beheer > Systeem > Bouwstenen): elke bouwsteen met een voorbeeld, zodat
  de design-controle (uitlijning op 1440 en 375 px en axe) ze op één scherm kan nalopen. Alle gegevens zijn verzonnen
  en staan in dit bestand; er gaat niets naar de server.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import DataTable from '../../components/data-table.vue';
import StatusBadge from '../../components/status-badge.vue';
import FilterTabs from '../../components/filter-tabs.vue';
import SearchField from '../../components/search-field.vue';
import PagerNav from '../../components/pager-nav.vue';
import TabPanels from '../../components/tab-panels.vue';
import SaveBar from '../../components/save-bar.vue';
import TextField from '../../components/text-field.vue';
import ConfirmDialog from '../../components/confirm-dialog.vue';
import StatusMessage from '../../components/status-message.vue';

/** Voorbeeldrijen voor de lijst. */
const SAMPLE_ROWS = [
  { id: 1, naam: 'Voorbeeldreis Noorwegen', vertrek: '12-07-2027', plaatsen: 15, status: 'gepubliceerd' },
  { id: 2, naam: 'Voorbeeldreis Schotland met een heel lange naam die afbreekt', vertrek: '02-08-2027', plaatsen: 12, status: 'concept' },
  { id: 3, naam: 'Voorbeeldreis Zweden', vertrek: '20-08-2027', plaatsen: 0, status: 'vol' },
];

const columns = [
  { key: 'naam', label: 'Naam', wrap: true },
  { key: 'vertrek', label: 'Vertrek' },
  { key: 'plaatsen', label: 'Plaatsen vrij', numeric: true },
  { key: 'status', label: 'Status' },
];

const filter = ref('');
const search = ref('');
const page = ref(1);
const rows = computed(() => SAMPLE_ROWS.filter((row) => (!filter.value || row.status === filter.value)
  && row.naam.toLowerCase().includes(search.value.toLowerCase())));
const filterOptions = computed(() => [
  { value: '', label: 'Alle', count: SAMPLE_ROWS.length },
  { value: 'gepubliceerd', label: 'Gepubliceerd', count: SAMPLE_ROWS.filter((row) => row.status === 'gepubliceerd').length },
  { value: 'concept', label: 'Concept', count: SAMPLE_ROWS.filter((row) => row.status === 'concept').length },
]);

const tab = ref('gegevens');
const title = ref('Voorbeeldreis Noorwegen');
const summary = ref('');
const titleError = computed(() => (title.value.trim() ? '' : 'Vul een titel in.'));
const saved = ref('');
const busy = ref(false);
const dialogOpen = ref(false);
const removed = ref('');

/** Doet alsof het formulier wordt opgeslagen (er gaat niets naar de server). */
function save(): void {
  if (titleError.value) return;
  busy.value = true;
  saved.value = '';
  window.setTimeout(() => {
    busy.value = false;
    saved.value = 'Opgeslagen (voorbeeld, er is niets bewaard).';
  }, 300);
}

/** Bevestiging uit het venster. */
function confirmRemove(): void {
  dialogOpen.value = false;
  removed.value = 'Verwijderd (voorbeeld, er is niets weggehaald).';
}
</script>

<template>
  <div class="crm-bouwstenen">
    <p>Dit scherm toont de bouwstenen van de nieuwe schermen van het CRM, met een voorbeeld van elk. Alle gegevens zijn verzonnen; er wordt niets opgeslagen.</p>

    <section
      class="crm-panel"
      aria-labelledby="bouwsteen-lijst"
    >
      <h2 id="bouwsteen-lijst">
        Lijst met filter, zoeken en bladeren
      </h2>
      <FilterTabs
        v-model="filter"
        name="status"
        label="Filter op status"
        :options="filterOptions"
      />
      <SearchField
        v-model="search"
        label="Zoek op naam"
      />
      <DataTable
        :columns="columns"
        :rows="rows"
        caption="Voorbeeldreizen"
        empty="Geen reizen gevonden."
      >
        <template #cel-naam="{ row }">
          <a href="#bouwsteen-lijst">{{ row.naam }}</a>
        </template>
        <template #cel-status="{ row }">
          <StatusBadge
            :kind="row.status"
            :label="row.status"
          />
        </template>
      </DataTable>
      <PagerNav
        v-model:page="page"
        :has-next="page < 3"
      />
    </section>

    <section
      class="crm-panel"
      aria-labelledby="bouwsteen-formulier"
    >
      <h2 id="bouwsteen-formulier">
        Formulier met tabbladen en opslaanbalk
      </h2>
      <StatusMessage
        kind="succes"
        :message="saved"
        dismissible
        @dismiss="saved = ''"
      />
      <form
        novalidate
        @submit.prevent="save"
      >
        <TabPanels
          v-model="tab"
          label="Onderdelen van het voorbeeld"
          :tabs="[{ key: 'gegevens', label: 'Gegevens', error: Boolean(titleError) }, { key: 'tekst', label: 'Tekst' }]"
        >
          <template #tab-gegevens>
            <TextField
              v-model="title"
              label="Titel"
              help="Zoals op de site."
              :error="titleError"
              :maxlength="120"
              required
            />
          </template>
          <template #tab-tekst>
            <TextField
              v-model="summary"
              label="Samenvatting"
              multiline
              :maxlength="500"
            />
          </template>
        </TabPanels>
        <SaveBar
          label="Opslaan"
          note="Voorbeeld: er wordt niets bewaard."
          :busy="busy"
        />
      </form>
    </section>

    <section
      class="crm-panel"
      aria-labelledby="bouwsteen-meldingen"
    >
      <h2 id="bouwsteen-meldingen">
        Meldingen en bevestigen
      </h2>
      <StatusMessage
        kind="info"
        message="Een melding ter informatie."
      />
      <StatusMessage
        kind="fout"
        message="Een foutmelding: dit ging mis."
      />
      <StatusMessage
        kind="succes"
        :message="removed"
      />
      <button
        class="btn btn--outline"
        type="button"
        @click="dialogOpen = true"
      >
        Voorbeeld verwijderen
      </button>
      <ConfirmDialog
        :open="dialogOpen"
        title="Voorbeeld verwijderen?"
        message="Dit is een voorbeeld; er wordt niets verwijderd."
        confirm-label="Verwijderen"
        danger
        @confirm="confirmRemove"
        @cancel="dialogOpen = false"
      />
    </section>
  </div>
</template>

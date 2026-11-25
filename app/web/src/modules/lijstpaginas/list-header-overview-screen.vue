<!--
  Overzicht van de lijstpagina's (`/app/lijstpaginas/`): de vijf vaste koppen (Reizen, Reisleiders, Blog, Veelgestelde
  vragen en het aanmeldformulier) met titel, foto ja of nee en waar de inhoud vandaan komt. Zelfde inhoud als het oude
  scherm (`app/src/cms/list-header-routes.js`).
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import DataTable, { type TableColumn } from '../../components/data-table.vue';
import StatusMessage from '../../components/status-message.vue';
import { ApiError } from '../../api/client';
import { setPageTitle } from '../../shell/page-title';
import { listHeaderApi as defaultApi, type ListHeader, type ListHeaderApi } from './list-header-api';

const props = defineProps<{
  /** Functies voor de API (tests geven een eigen versie mee). */
  headers?: ListHeaderApi;
}>();
const headers = props.headers || defaultApi;

/** Kolommen van de lijst. */
const COLUMNS: TableColumn[] = [
  { key: 'naam', label: 'Pagina' },
  { key: 'titel', label: 'Titel', wrap: true },
  { key: 'foto', label: 'Foto' },
  { key: 'bronNaam', label: 'Inhoud' },
];

const rows = ref<ListHeader[] | null>(null);
const loadError = ref('');

onMounted(async () => {
  setPageTitle('Lijstpagina\'s');
  try {
    rows.value = (await headers.overview()).koppen;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Het overzicht kon niet worden geladen.';
  }
});
</script>

<template>
  <div>
    <p>De kop bovenaan de pagina's met reizen, reisleiders, blog en veelgestelde vragen, en boven het aanmeldformulier.</p>
    <StatusMessage
      kind="fout"
      :message="loadError"
    />
    <p
      v-if="!rows && !loadError"
      class="crm-empty"
    >
      Laden…
    </p>
    <DataTable
      v-if="rows"
      :columns="COLUMNS"
      :rows="rows"
      empty="Geen lijstpagina's."
    >
      <template #cel-naam="{ row }">
        <RouterLink :to="`/${row.sleutel}/`">
          {{ row.naam }}
        </RouterLink>
      </template>
      <template #cel-foto="{ row }">
        {{ row.foto ? 'Ja' : 'Nee' }}
      </template>
    </DataTable>
  </div>
</template>

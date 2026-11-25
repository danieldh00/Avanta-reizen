<!--
  Overzicht van de reistypes en landen (`/app/reistypes-en-landen/`): een tabblad per soort met het aantal, zoeken op
  naam, slug of landcode (alle landen van de wereld staan erin, dus de lijst is lang), de lijst met icoon of landcode,
  volgorde, homepage, reizen en foto's, en een formulier voor een nieuwe. Soort en zoekterm staan in het adres.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import DataTable, { type TableColumn } from '../../components/data-table.vue';
import FilterTabs from '../../components/filter-tabs.vue';
import SearchField from '../../components/search-field.vue';
import StatusMessage from '../../components/status-message.vue';
import { ApiError } from '../../api/client';
import { setPageTitle } from '../../shell/page-title';
import CategoryFields from './category-fields.vue';
import CategoryIcon from './category-icon.vue';
import { categoryInputOf, emptyCategoryForm } from './category-form';
import { categoryApi as defaultApi, NOTICES, type CategoryApi, type CategoryKind, type CategoryListItem, type CategoryOverview } from './category-api';

const props = defineProps<{
  /** Functies voor de API (tests geven een eigen versie mee). */
  categories?: CategoryApi;
}>();
const categories = props.categories || defaultApi;
const route = useRoute();
const router = useRouter();

/** Soorten in de volgorde van de tabbladen. */
const KIND_ORDER: CategoryKind[] = ['type', 'bestemming', 'overig'];

/**
 * Leest een tekst uit het adres.
 * @param value Waarde van de parameter.
 * @returns De tekst (leeg als hij ontbreekt).
 */
const queryText = (value: unknown): string => (typeof value === 'string' ? value : '');

const overview = ref<CategoryOverview | null>(null);
const loadError = ref('');
const notice = ref(NOTICES[queryText(route.query.melding)] || '');
const kind = ref<CategoryKind>(KIND_ORDER.includes(queryText(route.query.soort) as CategoryKind) ? queryText(route.query.soort) as CategoryKind : 'type');
const search = ref(queryText(route.query.q).slice(0, 100));
const busy = ref(false);
const addOpen = ref(false);
const form = ref(emptyCategoryForm());
const errors = ref<Record<string, string>>({});
const formError = ref('');

/** Tabbladen met het aantal per soort. */
const tabs = computed(() => KIND_ORDER.map((value) => ({
  value,
  label: overview.value?.soorten.find((info) => info.soort === value)?.meervoud || value,
  count: overview.value ? overview.value.items.filter((item) => item.soort === value).length : undefined,
})));

/** De categorieën van de gekozen soort die bij de zoekterm passen (naam, slug of landcode). */
const rows = computed<CategoryListItem[]>(() => {
  const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  return (overview.value?.items || []).filter((item) => item.soort === kind.value
    && terms.every((term) => `${item.naam} ${item.adres} ${item.code || ''}`.toLowerCase().includes(term)));
});

/** Kolommen; icoon alleen bij reistypes, landcode alleen bij landen. */
const columns = computed<TableColumn[]>(() => [
  { key: 'naam', label: 'Naam', wrap: true },
  { key: 'adres', label: 'Slug' },
  ...(kind.value === 'type' ? [{ key: 'icoon', label: 'Icoon' }] : []),
  ...(kind.value === 'bestemming' ? [{ key: 'code', label: 'Code' }] : []),
  { key: 'volgorde', label: 'Volgorde', numeric: true },
  { key: 'homepage', label: 'Homepage' },
  { key: 'reizen', label: 'Reizen (komend)', numeric: true },
  { key: 'fotos', label: 'Foto\'s', numeric: true },
]);

/** Naam van de gekozen soort, voor de lege lijst en het bijschrift. */
const kindTitle = computed(() => tabs.value.find((tab) => tab.value === kind.value)?.label || '');

/** Overige parameters van het adres voor de links van de tabbladen. */
const listQuery = computed(() => {
  const query: Record<string, string> = {};
  if (search.value) query.q = search.value;
  return query;
});

// Soort en zoekterm in het adres, zodat terug, herladen en een bladwijzer dezelfde lijst geven.
watch([kind, search], () => {
  void router.replace({ query: { ...(kind.value !== 'type' ? { soort: kind.value } : {}), ...(search.value ? { q: search.value } : {}) } });
});

/** Laadt het overzicht van de server. */
async function load(): Promise<void> {
  try {
    overview.value = await categories.overview();
    loadError.value = '';
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Het overzicht kon niet worden geladen.';
  }
}

/** Maakt een nieuwe en opent die; bij een fout blijven de velden staan met de melding per veld. */
async function add(): Promise<void> {
  busy.value = true;
  errors.value = {};
  formError.value = '';
  try {
    const result = await categories.create(categoryInputOf(form.value));
    await router.push({ path: `/${result.id}/`, query: { melding: 'opgeslagen' } });
  } catch (error) {
    errors.value = error instanceof ApiError ? error.fields : {};
    formError.value = error instanceof ApiError ? error.message : 'Dat lukte niet.';
  }
  busy.value = false;
}

onMounted(async () => {
  setPageTitle('Reistypes en landen');
  // De melding hoort bij de wissel hiernaartoe; bij herladen hoeft hij niet terug te komen.
  if (route.query.melding) void router.replace({ query: { ...route.query, melding: undefined } });
  await load();
});
</script>

<template>
  <div>
    <StatusMessage
      kind="succes"
      :message="notice"
      dismissible
      @dismiss="notice = ''"
    />
    <StatusMessage
      kind="fout"
      :message="loadError"
    />
    <p
      v-if="!overview && !loadError"
      class="crm-empty"
    >
      Laden…
    </p>
    <template v-if="overview">
      <details
        class="crm-block"
        :open="addOpen"
        @toggle="addOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary><strong>Nieuw reistype of land</strong></summary>
        <form
          class="form crm-narrow"
          novalidate
          @submit.prevent="add"
        >
          <StatusMessage
            kind="fout"
            :message="formError"
          />
          <CategoryFields
            v-model="form"
            :kinds="overview.soorten"
            :icons="Object.keys(overview.iconen)"
            :limits="overview.grenzen"
            :errors="errors"
          />
          <div>
            <button
              class="btn"
              type="submit"
              :disabled="busy"
            >
              Aanmaken
            </button>
          </div>
        </form>
      </details>
      <FilterTabs
        v-model="kind"
        :options="tabs"
        name="soort"
        label="Soorten"
        :query="listQuery"
      />
      <SearchField
        v-model="search"
        label="Zoek op naam, slug of landcode"
      />
      <p
        class="crm-empty"
        role="status"
      >
        {{ rows.length }} {{ rows.length === 1 ? 'categorie' : 'categorieën' }}{{ search ? ` gevonden voor '${search}'` : '' }}
      </p>
      <DataTable
        :columns="columns"
        :rows="rows"
        :empty="search ? 'Niets gevonden. Zoek op een ander woord of kies een andere soort.' : 'Nog niets in deze soort.'"
        :caption="kindTitle"
      >
        <template #cel-naam="{ row }">
          <RouterLink :to="`/${row.id}/`">
            {{ row.naam }}
          </RouterLink>
        </template>
        <template #cel-icoon="{ row }">
          <CategoryIcon
            v-if="row.icoon"
            :name="String(row.icoon)"
            :shapes="overview.iconen[String(row.icoon)] || []"
          />
        </template>
        <template #cel-code="{ row }">
          {{ row.code || '–' }}
        </template>
        <template #cel-homepage="{ row }">
          {{ row.homepage ? 'ja' : '–' }}
        </template>
        <template #cel-reizen="{ row }">
          {{ row.reizen }} ({{ row.komend }})
        </template>
      </DataTable>
    </template>
  </div>
</template>

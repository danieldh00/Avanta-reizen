<!--
  Overzicht van de categorieën en tags van het blog (`/app/blog/categorieen-en-tags/`): per soort de lijst met adres,
  aantal berichten en volgorde, en een formulier om er een toe te voegen. Zelfde inhoud en opmaak als het oude scherm
  van de server (`app/src/cms/post-term-routes.js`).
-->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import DataTable, { type TableColumn } from '../../components/data-table.vue';
import StatusMessage from '../../components/status-message.vue';
import TextField from '../../components/text-field.vue';
import { ApiError } from '../../api/client';
import { readOrder } from '../../components/order-tools';
import { setPageTitle } from '../../shell/page-title';
import { NOTICES, termApi as defaultApi, type TermApi, type TermKind, type TermOverview } from './term-api';

const props = defineProps<{
  /** Functies voor de API (tests geven een eigen versie mee). */
  terms?: TermApi;
}>();
const terms = props.terms || defaultApi;
const route = useRoute();
const router = useRouter();

const overview = ref<TermOverview | null>(null);
const loadError = ref('');
const notice = ref(NOTICES[String(route.query.melding || '')] || '');
const busy = ref(false);

/** Ingevulde velden van een nieuw formulier. */
interface NewTerm {
  naam: string;
  adres: string;
  inleiding: string;
  volgorde: string;
  open: boolean;
  errors: Record<string, string>;
}

/**
 * Een leeg formulier.
 * @returns Lege velden.
 */
const emptyForm = (): NewTerm => ({ naam: '', adres: '', inleiding: '', volgorde: '', open: false, errors: {} });

/** Een formulier per soort. */
const forms = reactive<Record<TermKind, NewTerm>>({ categorie: emptyForm(), tag: emptyForm() });

const columns: TableColumn[] = [
  { key: 'naam', label: 'Naam', wrap: true },
  { key: 'adres', label: 'Adres' },
  { key: 'berichten', label: 'Berichten', numeric: true },
  { key: 'volgorde', label: 'Volgorde', numeric: true },
];

/** Laadt het overzicht opnieuw van de server. */
async function load(): Promise<void> {
  try {
    overview.value = await terms.overview();
    loadError.value = '';
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Het overzicht kon niet worden geladen.';
  }
}

/**
 * Voegt een categorie of tag toe; bij een fout blijven de velden staan met de melding per veld.
 * @param kind Soort.
 */
async function add(kind: TermKind): Promise<void> {
  const form = forms[kind];
  busy.value = true;
  form.errors = {};
  notice.value = '';
  try {
    await terms.create({ soort: kind, naam: form.naam, adres: form.adres, inleiding: form.inleiding, volgorde: readOrder(form.volgorde) });
    forms[kind] = emptyForm();
    notice.value = 'Opgeslagen.';
    await load();
  } catch (error) {
    form.errors = error instanceof ApiError ? { ...error.fields, _: Object.keys(error.fields).length ? '' : error.message } : { _: 'Dat lukte niet.' };
  }
  busy.value = false;
}

onMounted(async () => {
  setPageTitle('Categorieën en tags');
  // De melding hoort bij de wissel hiernaartoe; bij herladen hoeft hij niet terug te komen.
  if (route.query.melding) void router.replace({ query: {}, hash: route.hash });
  await load();
});
</script>

<template>
  <div>
    <p><a href="/app/blog/">Naar het blog</a></p>
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
      <section
        v-for="group in overview.soorten"
        :id="group.soort"
        :key="group.soort"
        class="crm-block"
      >
        <h2>{{ group.meervoud }}</h2>
        <DataTable
          :columns="columns"
          :rows="group.items"
          :empty="`Nog geen ${group.meervoud.toLowerCase()}.`"
          :caption="group.meervoud"
        >
          <template #cel-naam="{ row }">
            <RouterLink :to="`/${row.id}/`">
              {{ row.naam }}
            </RouterLink>
          </template>
          <template #cel-adres="{ row }">
            <code>{{ group.voorvoegsel }}{{ row.adres }}/</code>
          </template>
        </DataTable>
        <details
          class="cms-style"
          :open="forms[group.soort].open"
          @toggle="forms[group.soort].open = ($event.target as HTMLDetailsElement).open"
        >
          <summary>{{ group.naam }} toevoegen</summary>
          <form
            class="form crm-narrow"
            novalidate
            @submit.prevent="add(group.soort)"
          >
            <StatusMessage
              kind="fout"
              :message="forms[group.soort].errors._ || ''"
            />
            <TextField
              v-model="forms[group.soort].naam"
              label="Naam"
              :maxlength="overview.grenzen.naam"
              :error="forms[group.soort].errors.naam"
              required
            />
            <TextField
              v-model="forms[group.soort].adres"
              label="Adres"
              :maxlength="overview.grenzen.adres"
              help="Kleine letters, cijfers en streepjes. Leeg = gemaakt uit de naam."
              :error="forms[group.soort].errors.adres"
            />
            <TextField
              v-model="forms[group.soort].inleiding"
              label="Inleiding (boven de lijst met berichten)"
              multiline
              :maxlength="overview.grenzen.inleiding"
              :error="forms[group.soort].errors.inleiding"
            />
            <TextField
              v-model="forms[group.soort].volgorde"
              label="Volgorde"
              type="number"
              help="Lager staat eerder (bij tags: in de balk boven het blog)."
              :error="forms[group.soort].errors.volgorde"
            />
            <div>
              <button
                class="btn btn--small"
                type="submit"
                :disabled="busy"
              >
                Toevoegen
              </button>
            </div>
          </form>
        </details>
      </section>
    </template>
  </div>
</template>

<!--
  Overzicht van de veelgestelde vragen (`/app/faq/`): per categorie de vragen, met knoppen om categorieën en vragen een
  plaats omhoog of omlaag te zetten, vragen zonder categorie (uit de import) apart, en een formulier voor een nieuwe
  categorie. Zelfde inhoud en opmaak als het oude scherm van de server (`app/src/cms/faq-routes.js`).
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import DataTable, { type TableColumn } from '../../components/data-table.vue';
import StatusMessage from '../../components/status-message.vue';
import TextField from '../../components/text-field.vue';
import { ApiError } from '../../api/client';
import { setPageTitle } from '../../shell/page-title';
import { faqApi as defaultApi, moveId, readOrder, type FaqApi, type FaqListQuestion, type FaqOverview } from './faq-api';
import { NOTICES } from './notices';

const props = defineProps<{
  /** Functies voor de API (tests geven een eigen versie mee). */
  faq?: FaqApi;
}>();
const faq = props.faq || defaultApi;
const route = useRoute();
const router = useRouter();

const overview = ref<FaqOverview | null>(null);
const loadError = ref('');
const actionError = ref('');
const notice = ref(NOTICES[String(route.query.melding || '')] || '');
const busy = ref(false);
const newName = ref('');
const newOrder = ref('');
const newErrors = ref<Record<string, string>>({});
const addOpen = ref(false);

const columns: TableColumn[] = [
  { key: 'vraag', label: 'Vraag', wrap: true },
  { key: 'volgorde', label: 'Volgorde', numeric: true },
  { key: 'verplaatsen', label: 'Verplaatsen' },
];

/** Vragen als rijen voor de lijst (met een lege cel voor de knoppen). */
type QuestionRow = { id: number; vraag: string; volgorde: number; verplaatsen: string };

/**
 * Maakt rijen van de vragen voor de lijst.
 * @param questions Vragen.
 * @returns Rijen.
 */
function rowsOf(questions: FaqListQuestion[]): QuestionRow[] {
  return questions.map((question) => ({ id: question.id, vraag: question.vraag, volgorde: question.volgorde, verplaatsen: '' }));
}

const categoryIds = computed(() => (overview.value ? overview.value.categorieen.map((category) => category.id) : []));

/** Laadt het overzicht opnieuw van de server. */
async function load(): Promise<void> {
  try {
    overview.value = await faq.overview();
    loadError.value = '';
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Het overzicht kon niet worden geladen.';
  }
}

/**
 * Voert een wijziging uit en laadt daarna het overzicht opnieuw; een fout komt in de melding boven de lijst.
 * @param change De wijziging.
 * @param success Melding als het gelukt is.
 */
async function apply(change: () => Promise<unknown>, success: string): Promise<void> {
  busy.value = true;
  actionError.value = '';
  notice.value = '';
  try {
    await change();
    notice.value = success;
  } catch (error) {
    actionError.value = error instanceof ApiError ? error.message : 'Dat lukte niet.';
  }
  await load();
  busy.value = false;
}

/**
 * Zet een categorie een plaats omhoog of omlaag.
 * @param id Id van de categorie.
 * @param step -1 omhoog, 1 omlaag.
 */
function moveCategory(id: number, step: -1 | 1): void {
  const order = moveId(categoryIds.value, id, step);
  if (order) void apply(() => faq.orderCategories(order), 'De volgorde is opgeslagen.');
}

/**
 * Zet een vraag binnen haar categorie een plaats omhoog of omlaag.
 * @param categoryId Id van de categorie.
 * @param questions Vragen van die categorie in de huidige volgorde.
 * @param id Id van de vraag.
 * @param step -1 omhoog, 1 omlaag.
 */
function moveQuestion(categoryId: number, questions: FaqListQuestion[], id: number, step: -1 | 1): void {
  const order = moveId(questions.map((question) => question.id), id, step);
  if (order) void apply(() => faq.orderQuestions(categoryId, order), 'De volgorde is opgeslagen.');
}

/** Voegt een categorie toe; bij een fout blijven de velden staan met de melding per veld. */
async function addCategory(): Promise<void> {
  busy.value = true;
  newErrors.value = {};
  notice.value = '';
  try {
    await faq.createCategory({ naam: newName.value, volgorde: readOrder(newOrder.value) });
    newName.value = '';
    newOrder.value = '';
    addOpen.value = false;
    notice.value = 'De categorie is toegevoegd.';
    await load();
  } catch (error) {
    newErrors.value = error instanceof ApiError ? { ...error.fields, _: error.fields.naam ? '' : error.message } : { _: 'Dat lukte niet.' };
  }
  busy.value = false;
}

onMounted(async () => {
  setPageTitle('Veelgestelde vragen');
  // De melding hoort bij de wissel hiernaartoe; bij herladen hoeft hij niet terug te komen.
  if (route.query.melding) void router.replace({ query: {} });
  await load();
});
</script>

<template>
  <div>
    <p><a href="/faq/">Bekijk op de site</a></p>
    <StatusMessage
      kind="succes"
      :message="notice"
      dismissible
      @dismiss="notice = ''"
    />
    <StatusMessage
      kind="fout"
      :message="actionError || loadError"
    />
    <p
      v-if="!overview && !loadError"
      class="crm-empty"
    >
      Laden…
    </p>
    <template v-if="overview">
      <p v-if="overview.categorieen.length">
        <RouterLink
          class="btn btn--small"
          to="/nieuw/"
        >
          Vraag toevoegen
        </RouterLink>
      </p>
      <p v-else>
        Maak eerst een categorie; daarna voeg je vragen toe.
      </p>
      <section
        v-for="(category, index) in overview.categorieen"
        :id="`categorie-${category.id}`"
        :key="category.id"
        class="crm-block"
      >
        <h2>{{ category.naam }}</h2>
        <p>
          <RouterLink :to="`/categorieen/${category.id}/`">
            Categorie wijzigen
          </RouterLink>
          ·
          <RouterLink :to="{ path: '/nieuw/', query: { categorie: String(category.id) } }">
            Vraag toevoegen
          </RouterLink>
          · volgorde {{ category.volgorde }}
        </p>
        <p
          v-if="overview.categorieen.length > 1"
          class="crm-actions"
        >
          <button
            class="btn btn--small btn--outline"
            type="button"
            :disabled="busy || index === 0"
            @click="moveCategory(category.id, -1)"
          >
            Categorie omhoog
          </button>
          <button
            class="btn btn--small btn--outline"
            type="button"
            :disabled="busy || index === overview.categorieen.length - 1"
            @click="moveCategory(category.id, 1)"
          >
            Categorie omlaag
          </button>
        </p>
        <DataTable
          :columns="columns"
          :rows="rowsOf(category.vragen)"
          empty="Nog geen vragen."
          :caption="`Vragen in ${category.naam}`"
        >
          <template #cel-vraag="{ row }">
            <RouterLink :to="`/${row.id}/`">
              {{ row.vraag }}
            </RouterLink>
          </template>
          <template #cel-verplaatsen="{ row }">
            <span class="crm-actions">
              <button
                class="btn btn--small btn--outline"
                type="button"
                :aria-label="`${row.vraag}: omhoog`"
                :disabled="busy || row.id === category.vragen[0]?.id"
                @click="moveQuestion(category.id, category.vragen, row.id, -1)"
              >
                Omhoog
              </button>
              <button
                class="btn btn--small btn--outline"
                type="button"
                :aria-label="`${row.vraag}: omlaag`"
                :disabled="busy || row.id === category.vragen[category.vragen.length - 1]?.id"
                @click="moveQuestion(category.id, category.vragen, row.id, 1)"
              >
                Omlaag
              </button>
            </span>
          </template>
        </DataTable>
      </section>
      <section
        v-if="overview.los.length"
        class="crm-block"
      >
        <h2>Zonder categorie</h2>
        <p>Deze vragen komen uit de import; kies een categorie om ze te ordenen.</p>
        <DataTable
          :columns="columns.slice(0, 2)"
          :rows="rowsOf(overview.los)"
          empty="Nog geen vragen."
          caption="Vragen zonder categorie"
        >
          <template #cel-vraag="{ row }">
            <RouterLink :to="`/${row.id}/`">
              {{ row.vraag }}
            </RouterLink>
          </template>
        </DataTable>
      </section>
      <section class="crm-block">
        <details
          class="cms-style"
          :open="addOpen"
          @toggle="addOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary>Categorie toevoegen</summary>
          <form
            class="form crm-narrow"
            novalidate
            @submit.prevent="addCategory"
          >
            <StatusMessage
              kind="fout"
              :message="newErrors._ || ''"
            />
            <TextField
              v-model="newName"
              label="Naam"
              :maxlength="overview.grenzen.naam"
              :error="newErrors.naam"
              required
            />
            <TextField
              v-model="newOrder"
              label="Volgorde"
              type="number"
              help="Lager staat eerder op de FAQ-pagina."
              :error="newErrors.volgorde"
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

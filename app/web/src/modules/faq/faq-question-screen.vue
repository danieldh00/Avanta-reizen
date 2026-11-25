<!--
  Een vraag toevoegen (`/app/faq/nieuw/`, eventueel met `?categorie=<id>`) of wijzigen (`/app/faq/<id>/`): vraag,
  categorie, opgemaakt antwoord en volgorde, en bij een bestaande vraag verwijderen na bevestigen. De server controleert
  en schoont alles op; zijn meldingen komen per veld terug.
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import ConfirmDialog from '../../components/confirm-dialog.vue';
import FormField from '../../components/form-field.vue';
import RichTextEditor from '../../components/rich-text-editor.vue';
import SaveBar from '../../components/save-bar.vue';
import StatusMessage from '../../components/status-message.vue';
import TextField from '../../components/text-field.vue';
import { ApiError } from '../../api/client';
import { setPageTitle } from '../../shell/page-title';
import { faqApi as defaultApi, readOrder, type FaqApi, type FaqCategory, type FaqLimits } from './faq-api';

const props = defineProps<{
  /** Id van een bestaande vraag; leeg bij een nieuwe. */
  id?: number;
  /** Functies voor de API (tests geven een eigen versie mee). */
  faq?: FaqApi;
}>();
const faq = props.faq || defaultApi;
const route = useRoute();
const router = useRouter();
const isNew = computed(() => !props.id);

const categories = ref<FaqCategory[]>([]);
const limits = ref<FaqLimits | null>(null);
const question = ref('');
const answer = ref('');
const categoryId = ref('');
const order = ref('');
const errors = ref<Record<string, string>>({});
const formError = ref('');
const loadError = ref('');
const missing = ref(false);
const busy = ref(false);
const confirmOpen = ref(false);

/** Laadt de categorieën en, bij een bestaande vraag, de vraag zelf. */
async function load(): Promise<void> {
  try {
    const [overview, existing] = await Promise.all([faq.overview(), props.id ? faq.question(props.id) : Promise.resolve(null)]);
    categories.value = overview.categorieen;
    limits.value = overview.grenzen;
    if (existing) {
      question.value = existing.vraag;
      answer.value = existing.antwoord;
      categoryId.value = existing.categorieId ? String(existing.categorieId) : '';
      order.value = String(existing.volgorde);
    } else {
      const preset = String(route.query.categorie || '');
      categoryId.value = overview.categorieen.some((category) => String(category.id) === preset) ? preset : '';
      order.value = '0';
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) missing.value = true;
    else loadError.value = error instanceof ApiError ? error.message : 'De vraag kon niet worden geladen.';
  }
}

/**
 * Toont de fout van de server: per veld, en anders boven het formulier.
 * @param error De fout.
 */
function showError(error: unknown): void {
  if (error instanceof ApiError && error.status === 404) {
    missing.value = true;
    return;
  }
  errors.value = error instanceof ApiError ? error.fields : {};
  formError.value = error instanceof ApiError ? error.message : 'Opslaan lukte niet.';
}

/** Slaat de vraag op en gaat terug naar het overzicht. */
async function save(): Promise<void> {
  busy.value = true;
  errors.value = {};
  formError.value = '';
  const input = { vraag: question.value, antwoord: answer.value, categorieId: Number(categoryId.value) || 0, volgorde: readOrder(order.value) };
  try {
    if (props.id) await faq.updateQuestion(props.id, input);
    else await faq.createQuestion(input);
    await router.push({ path: '/', query: { melding: 'opgeslagen' }, hash: `#categorie-${input.categorieId}` });
  } catch (error) {
    showError(error);
  }
  busy.value = false;
}

/** Verwijdert de vraag na bevestigen en gaat terug naar het overzicht. */
async function remove(): Promise<void> {
  confirmOpen.value = false;
  if (!props.id) return;
  busy.value = true;
  try {
    await faq.removeQuestion(props.id);
    await router.push({ path: '/', query: { melding: 'vraag-weg' } });
  } catch (error) {
    showError(error);
  }
  busy.value = false;
}

onMounted(async () => {
  setPageTitle(isNew.value ? 'Vraag toevoegen' : 'Vraag wijzigen');
  await load();
});
</script>

<template>
  <div>
    <p>
      <RouterLink to="/">
        Naar de veelgestelde vragen
      </RouterLink>
    </p>
    <p v-if="missing">
      Deze vraag bestaat niet (meer).
    </p>
    <StatusMessage
      v-else-if="loadError"
      kind="fout"
      :message="loadError"
    />
    <p
      v-else-if="!limits"
      class="crm-empty"
    >
      Laden…
    </p>
    <template v-else>
      <form
        class="form crm-block"
        novalidate
        @submit.prevent="save"
      >
        <StatusMessage
          kind="fout"
          :message="formError"
        />
        <TextField
          v-model="question"
          label="Vraag"
          :maxlength="limits.vraag"
          :error="errors.vraag"
          required
        />
        <FormField
          v-slot="field"
          label="Categorie"
          :error="errors.categorieId"
          required
        >
          <select
            :id="field.id"
            v-model="categoryId"
            required
            :aria-describedby="field.describedBy"
            :aria-invalid="field.invalid"
          >
            <option value="">
              Kies…
            </option>
            <option
              v-for="category in categories"
              :key="category.id"
              :value="String(category.id)"
            >
              {{ category.naam }}
            </option>
          </select>
        </FormField>
        <RichTextEditor
          v-model="answer"
          label="Antwoord"
          help="Typ de tekst zoals hij op de site komt: Enter begint een nieuwe alinea, Shift+Enter een nieuwe regel. Kopjes, vet, cursief, lijsten en links maak je met de knoppen boven het vak; met HTML zie en wijzig je de code. Andere opmaak, scripts en stijlen verdwijnen bij het opslaan."
          :maxlength="limits.antwoord"
          :error="errors.antwoord"
          required
        />
        <TextField
          v-model="order"
          label="Volgorde"
          type="number"
          help="Lager staat eerder binnen de categorie."
          :error="errors.volgorde"
        />
        <SaveBar
          :label="isNew ? 'Toevoegen' : 'Opslaan'"
          :busy="busy"
        />
      </form>
      <div
        v-if="!isNew"
        class="crm-block crm-actions"
      >
        <button
          class="btn btn--small btn--outline"
          type="button"
          :disabled="busy"
          @click="confirmOpen = true"
        >
          Verwijderen
        </button>
      </div>
      <ConfirmDialog
        :open="confirmOpen"
        title="Vraag verwijderen?"
        message="De vraag verdwijnt van de site. Dit kun je niet ongedaan maken."
        confirm-label="Verwijderen"
        danger
        @confirm="remove"
        @cancel="confirmOpen = false"
      />
    </template>
  </div>
</template>

<!--
  Een categorie wijzigen (`/app/faq/categorieen/<id>/`): naam en volgorde, en verwijderen na bevestigen als er geen
  vragen meer in staan. Een nieuwe naam gaat op de server mee naar de vragen.
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import ConfirmDialog from '../../components/confirm-dialog.vue';
import SaveBar from '../../components/save-bar.vue';
import StatusMessage from '../../components/status-message.vue';
import TextField from '../../components/text-field.vue';
import { ApiError } from '../../api/client';
import { setPageTitle } from '../../shell/page-title';
import { faqApi as defaultApi, readOrder, type FaqApi, type FaqCategoryDetails } from './faq-api';

/** Grootste lengte van een naam (gelijk aan de server, `FAQ_LIMITS.category`). */
const NAME_MAX = 120;

const props = defineProps<{
  /** Id van de categorie. */
  id: number;
  /** Functies voor de API (tests geven een eigen versie mee). */
  faq?: FaqApi;
}>();
const faq = props.faq || defaultApi;
const router = useRouter();

const category = ref<FaqCategoryDetails | null>(null);
const name = ref('');
const order = ref('');
const errors = ref<Record<string, string>>({});
const formError = ref('');
const loadError = ref('');
const missing = ref(false);
const busy = ref(false);
const confirmOpen = ref(false);

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
  formError.value = error instanceof ApiError ? error.message : 'Dat lukte niet.';
}

/** Slaat de categorie op en gaat terug naar het overzicht (met een melding als de naam anders is). */
async function save(): Promise<void> {
  busy.value = true;
  errors.value = {};
  formError.value = '';
  try {
    const result = await faq.updateCategory(props.id, { naam: name.value, volgorde: readOrder(order.value) });
    await router.push({ path: '/', query: { melding: result.hernoemd ? 'hernoemd' : 'opgeslagen' }, hash: `#categorie-${props.id}` });
  } catch (error) {
    showError(error);
  }
  busy.value = false;
}

/** Verwijdert de (lege) categorie na bevestigen en gaat terug naar het overzicht. */
async function remove(): Promise<void> {
  confirmOpen.value = false;
  busy.value = true;
  try {
    await faq.removeCategory(props.id);
    await router.push({ path: '/', query: { melding: 'categorie-weg' } });
  } catch (error) {
    showError(error);
  }
  busy.value = false;
}

onMounted(async () => {
  try {
    category.value = await faq.category(props.id);
    name.value = category.value.naam;
    order.value = String(category.value.volgorde);
    setPageTitle(`Categorie: ${category.value.naam}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) missing.value = true;
    else loadError.value = error instanceof ApiError ? error.message : 'De categorie kon niet worden geladen.';
  }
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
      Deze categorie bestaat niet (meer).
    </p>
    <StatusMessage
      v-else-if="loadError"
      kind="fout"
      :message="loadError"
    />
    <p
      v-else-if="!category"
      class="crm-empty"
    >
      Laden…
    </p>
    <template v-else>
      <form
        class="form crm-narrow crm-block"
        novalidate
        @submit.prevent="save"
      >
        <StatusMessage
          kind="fout"
          :message="formError"
        />
        <TextField
          v-model="name"
          label="Naam"
          :maxlength="NAME_MAX"
          :error="errors.naam"
          required
        />
        <TextField
          v-model="order"
          label="Volgorde"
          type="number"
          help="Lager staat eerder op de FAQ-pagina."
          :error="errors.volgorde"
        />
        <p class="field__help">
          Een FAQ-blok op een pagina kiest een categorie op naam: wijzig je de naam, kies de categorie in dat blok dan
          opnieuw.
        </p>
        <SaveBar
          label="Opslaan"
          :busy="busy"
        />
      </form>
      <p
        v-if="category.aantalVragen"
        class="crm-block"
      >
        Deze categorie heeft {{ category.aantalVragen }} {{ category.aantalVragen === 1 ? 'vraag' : 'vragen' }}.
        Verplaats of verwijder ze om de categorie te kunnen verwijderen.
      </p>
      <div
        v-else
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
        title="Categorie verwijderen?"
        message="De lege categorie verdwijnt. Dit kun je niet ongedaan maken."
        confirm-label="Verwijderen"
        danger
        @confirm="remove"
        @cancel="confirmOpen = false"
      />
    </template>
  </div>
</template>

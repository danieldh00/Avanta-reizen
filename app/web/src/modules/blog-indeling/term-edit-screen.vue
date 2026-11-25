<!--
  Een categorie of tag van het blog wijzigen (`/app/blog/categorieen-en-tags/<id>/`): naam, adres (een nieuw adres
  verwijst vanaf het oude door), inleiding en volgorde, en verwijderen na bevestigen (de berichten blijven).
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import ConfirmDialog from '../../components/confirm-dialog.vue';
import SaveBar from '../../components/save-bar.vue';
import StatusMessage from '../../components/status-message.vue';
import TextField from '../../components/text-field.vue';
import { ApiError } from '../../api/client';
import { readOrder } from '../../components/order-tools';
import { setPageTitle } from '../../shell/page-title';
import { termApi as defaultApi, type TermApi, type TermDetails } from './term-api';

/** Grootste lengtes (gelijk aan de server, `TERM_LIMITS` en `MAX_SLUG_LENGTH`). */
const LIMITS = { naam: 100, inleiding: 1000, adres: 80 };

const props = defineProps<{
  /** Id van de categorie of tag. */
  id: number;
  /** Functies voor de API (tests geven een eigen versie mee). */
  terms?: TermApi;
}>();
const terms = props.terms || defaultApi;
const router = useRouter();

const term = ref<TermDetails | null>(null);
const name = ref('');
const slug = ref('');
const intro = ref('');
const order = ref('');
const errors = ref<Record<string, string>>({});
const formError = ref('');
const loadError = ref('');
const missing = ref(false);
const busy = ref(false);
const confirmOpen = ref(false);

/** Adres op de site zoals het nu is opgeslagen. */
const siteAddress = computed(() => (term.value ? `${term.value.voorvoegsel}${term.value.adres}/` : ''));

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

/** Slaat op en gaat terug naar het overzicht, met een melding als het adres is gewijzigd. */
async function save(): Promise<void> {
  busy.value = true;
  errors.value = {};
  formError.value = '';
  try {
    const result = await terms.update(props.id, { naam: name.value, adres: slug.value, inleiding: intro.value, volgorde: readOrder(order.value) });
    await router.push({ path: '/', query: { melding: result.verplaatst ? 'verplaatst' : 'opgeslagen' }, hash: `#${term.value?.soort || ''}` });
  } catch (error) {
    showError(error);
  }
  busy.value = false;
}

/** Verwijdert na bevestigen en gaat terug naar het overzicht. */
async function remove(): Promise<void> {
  confirmOpen.value = false;
  busy.value = true;
  try {
    await terms.remove(props.id);
    await router.push({ path: '/', query: { melding: 'weg' } });
  } catch (error) {
    showError(error);
  }
  busy.value = false;
}

onMounted(async () => {
  try {
    term.value = await terms.term(props.id);
    name.value = term.value.naam;
    slug.value = term.value.adres;
    intro.value = term.value.inleiding;
    order.value = String(term.value.volgorde);
    setPageTitle(`${term.value.soortNaam}: ${term.value.naam}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) missing.value = true;
    else loadError.value = error instanceof ApiError ? error.message : 'De categorie of tag kon niet worden geladen.';
  }
});
</script>

<template>
  <div>
    <p>
      <RouterLink to="/">
        Naar categorieën en tags
      </RouterLink>
      <template v-if="term">
        · <a :href="siteAddress">Bekijk op de site</a>
      </template>
    </p>
    <p v-if="missing">
      Deze categorie of tag bestaat niet (meer).
    </p>
    <StatusMessage
      v-else-if="loadError"
      kind="fout"
      :message="loadError"
    />
    <p
      v-else-if="!term"
      class="crm-empty"
    >
      Laden…
    </p>
    <template v-else>
      <form
        novalidate
        @submit.prevent="save"
      >
        <div class="crm-block form crm-narrow">
          <StatusMessage
            kind="fout"
            :message="formError"
          />
          <TextField
            v-model="name"
            label="Naam"
            :maxlength="LIMITS.naam"
            :error="errors.naam"
            required
          />
          <TextField
            v-model="slug"
            label="Adres"
            :maxlength="LIMITS.adres"
            help="Kleine letters, cijfers en streepjes. Leeg = gemaakt uit de naam. Wijzig je het adres, dan verwijst het oude adres automatisch door."
            :error="errors.adres"
          />
          <TextField
            v-model="intro"
            label="Inleiding (boven de lijst met berichten)"
            multiline
            :maxlength="LIMITS.inleiding"
            :error="errors.inleiding"
          />
          <TextField
            v-model="order"
            label="Volgorde"
            type="number"
            help="Lager staat eerder (bij tags: in de balk boven het blog)."
            :error="errors.volgorde"
          />
        </div>
        <SaveBar
          label="Opslaan"
          :busy="busy"
        >
          <template #links>
            <button
              class="btn btn--outline"
              type="button"
              :disabled="busy"
              @click="confirmOpen = true"
            >
              Verwijderen
            </button>
          </template>
        </SaveBar>
      </form>
      <ConfirmDialog
        :open="confirmOpen"
        :title="`${term.soortNaam} verwijderen?`"
        message="De berichten blijven staan; het adres verwijst daarna naar het blog. Dit kun je niet ongedaan maken."
        confirm-label="Verwijderen"
        danger
        @confirm="remove"
        @cancel="confirmOpen = false"
      />
    </template>
  </div>
</template>

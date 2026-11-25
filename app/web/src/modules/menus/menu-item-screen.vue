<!--
  Een menu-item wijzigen (`/app/menus/<id>/`): menu, bovenliggend item, tekst, adres en volgorde, en verwijderen na
  bevestigen (een hoofditem neemt zijn submenu mee).
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import ConfirmDialog from '../../components/confirm-dialog.vue';
import SaveBar from '../../components/save-bar.vue';
import StatusMessage from '../../components/status-message.vue';
import { ApiError } from '../../api/client';
import { setPageTitle } from '../../shell/page-title';
import MenuItemFields from './menu-item-fields.vue';
import { emptyMenuForm, menuFormOf, menuInputOf } from './menu-form';
import { menuApi as defaultApi, type MenuApi, type MenuItemDetails, type MenuOverview } from './menu-api';

const props = defineProps<{
  /** Id van het item. */
  id: number;
  /** Functies voor de API (tests geven een eigen versie mee). */
  menus?: MenuApi;
}>();
const menus = props.menus || defaultApi;
const router = useRouter();

const item = ref<MenuItemDetails | null>(null);
const overview = ref<MenuOverview | null>(null);
const form = ref(emptyMenuForm());
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

/** Slaat op en gaat terug naar het overzicht. */
async function save(): Promise<void> {
  busy.value = true;
  errors.value = {};
  formError.value = '';
  try {
    await menus.update(props.id, menuInputOf(form.value));
    await router.push({ path: '/', query: { melding: 'gewijzigd' } });
  } catch (error) {
    showError(error);
  }
  busy.value = false;
}

/** Verwijdert het item na bevestigen en gaat terug naar het overzicht. */
async function remove(): Promise<void> {
  confirmOpen.value = false;
  busy.value = true;
  try {
    await menus.remove(props.id);
    await router.push({ path: '/', query: { melding: 'weg' } });
  } catch (error) {
    showError(error);
  }
  busy.value = false;
}

onMounted(async () => {
  try {
    const [details, all] = await Promise.all([menus.item(props.id), menus.overview()]);
    item.value = details;
    overview.value = all;
    form.value = menuFormOf(details);
    setPageTitle(`Menu-item: ${details.tekst}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) missing.value = true;
    else loadError.value = error instanceof ApiError ? error.message : 'Het menu-item kon niet worden geladen.';
  }
});
</script>

<template>
  <div>
    <p>
      <RouterLink to="/">
        Naar menu's
      </RouterLink>
    </p>
    <p v-if="missing">
      Dit menu-item bestaat niet (meer).
    </p>
    <StatusMessage
      v-else-if="loadError"
      kind="fout"
      :message="loadError"
    />
    <p
      v-else-if="!item || !overview"
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
          <MenuItemFields
            v-model="form"
            :menus="overview.menus"
            :suggestions="overview.suggesties"
            :limits="overview.grenzen"
            :self-id="item.id"
            :errors="errors"
            :prefix="`menu-${item.id}`"
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
        title="Menu-item verwijderen?"
        :message="item.aantalSubitems ? `Het item verdwijnt uit het menu, met de ${item.aantalSubitems} items van zijn submenu. Dit kun je niet ongedaan maken.` : 'Het item verdwijnt uit het menu. Dit kun je niet ongedaan maken.'"
        confirm-label="Verwijderen"
        danger
        @confirm="remove"
        @cancel="confirmOpen = false"
      />
    </template>
  </div>
</template>

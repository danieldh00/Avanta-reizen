<!--
  Overzicht van de menu's (`/app/menus/`): het hoofdmenu (submenu-items ingesprongen onder hun hoofditem) en het menu in
  de voettekst, met per item verwijderen na bevestigen, en het formulier voor een nieuw item. Zelfde inhoud en opmaak
  als het oude scherm van de server (`app/src/cms/menu-routes.js`).
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import ConfirmDialog from '../../components/confirm-dialog.vue';
import DataTable, { type TableColumn } from '../../components/data-table.vue';
import StatusMessage from '../../components/status-message.vue';
import { ApiError } from '../../api/client';
import { setPageTitle } from '../../shell/page-title';
import MenuItemFields from './menu-item-fields.vue';
import { emptyMenuForm, menuInputOf } from './menu-form';
import { menuApi as defaultApi, NOTICES, type MenuApi, type MenuItem, type MenuOverview } from './menu-api';

const props = defineProps<{
  /** Functies voor de API (tests geven een eigen versie mee). */
  menus?: MenuApi;
}>();
const menus = props.menus || defaultApi;
const route = useRoute();
const router = useRouter();

const overview = ref<MenuOverview | null>(null);
const loadError = ref('');
const actionError = ref('');
const notice = ref(NOTICES[String(route.query.melding || '')] || '');
const busy = ref(false);
const form = ref(emptyMenuForm());
const errors = ref<Record<string, string>>({});
const formError = ref('');
const toRemove = ref<MenuItem | null>(null);

const columns: TableColumn[] = [
  { key: 'tekst', label: 'Tekst', wrap: true },
  { key: 'adres', label: 'Adres' },
  { key: 'volgorde', label: 'Volgorde', numeric: true },
  { key: 'acties', label: 'Acties' },
];

/** Laadt het overzicht opnieuw van de server. */
async function load(): Promise<void> {
  try {
    overview.value = await menus.overview();
    loadError.value = '';
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'De menu\'s konden niet worden geladen.';
  }
}

/** Voegt een item toe; bij een fout blijven de velden staan met de melding per veld. */
async function add(): Promise<void> {
  busy.value = true;
  errors.value = {};
  formError.value = '';
  notice.value = '';
  try {
    await menus.create(menuInputOf(form.value));
    form.value = emptyMenuForm();
    notice.value = NOTICES.nieuw!;
    await load();
  } catch (error) {
    errors.value = error instanceof ApiError ? error.fields : {};
    formError.value = error instanceof ApiError ? error.message : 'Dat lukte niet.';
  }
  busy.value = false;
}

/** Verwijdert het gekozen item (met zijn submenu) na bevestigen. */
async function remove(): Promise<void> {
  const item = toRemove.value;
  toRemove.value = null;
  if (!item) return;
  busy.value = true;
  actionError.value = '';
  notice.value = '';
  try {
    await menus.remove(item.id);
    notice.value = NOTICES.weg!;
  } catch (error) {
    actionError.value = error instanceof ApiError ? error.message : 'Dat lukte niet.';
  }
  await load();
  busy.value = false;
}

onMounted(async () => {
  setPageTitle('Menu\'s');
  // De melding hoort bij de wissel hiernaartoe; bij herladen hoeft hij niet terug te komen.
  if (route.query.melding) void router.replace({ query: {} });
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
      :message="actionError || loadError"
    />
    <p
      v-if="!overview && !loadError"
      class="crm-empty"
    >
      Laden…
    </p>
    <template v-if="overview">
      <section
        v-for="group in overview.menus"
        :id="`menu-${group.menu}`"
        :key="group.menu"
        class="crm-block"
      >
        <h2>{{ group.naam }}</h2>
        <DataTable
          :columns="columns"
          :rows="group.items"
          empty="Dit menu is leeg; de site toont dan het vaste standaardmenu."
          :caption="group.naam"
        >
          <template #cel-tekst="{ row }">
            <span
              v-if="row.ouderId"
              aria-hidden="true"
            >↳ </span>
            <RouterLink :to="`/${row.id}/`">
              {{ row.tekst }}
            </RouterLink>
          </template>
          <template #cel-adres="{ row }">
            <code>{{ row.adres }}</code>
          </template>
          <template #cel-acties="{ row }">
            <button
              class="btn btn--small btn--outline"
              type="button"
              :aria-label="`${row.tekst}: verwijderen`"
              :disabled="busy"
              @click="toRemove = row as MenuItem"
            >
              Verwijderen
            </button>
          </template>
        </DataTable>
      </section>
      <section
        id="nieuw"
        class="crm-block"
      >
        <h2>Item toevoegen</h2>
        <form
          class="form crm-narrow"
          novalidate
          @submit.prevent="add"
        >
          <StatusMessage
            kind="fout"
            :message="formError"
          />
          <MenuItemFields
            v-model="form"
            :menus="overview.menus"
            :suggestions="overview.suggesties"
            :limits="overview.grenzen"
            :self-id="null"
            :errors="errors"
            prefix="menu-nieuw"
          />
          <p class="field__help">
            Een menu heeft hoogstens {{ overview.grenzen.items }} items. Verwijder je een hoofditem, dan gaat zijn submenu mee.
          </p>
          <div>
            <button
              class="btn"
              type="submit"
              :disabled="busy"
            >
              Toevoegen
            </button>
          </div>
        </form>
      </section>
      <ConfirmDialog
        :open="toRemove !== null"
        title="Menu-item verwijderen?"
        :message="`'${toRemove?.tekst || ''}' verdwijnt uit het menu, met zijn submenu. Dit kun je niet ongedaan maken.`"
        confirm-label="Verwijderen"
        danger
        @confirm="remove"
        @cancel="toRemove = null"
      />
    </template>
  </div>
</template>

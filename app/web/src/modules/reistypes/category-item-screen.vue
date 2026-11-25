<!--
  Eén reistype of land (`/app/reistypes-en-landen/<id>/`): de velden met opslaan (en verwijderen als er niets aan
  hangt), het gebruik, samenvoegen met een dubbeling van dezelfde soort, en de foto uit de fotobibliotheek (bij een land
  standaard de foto's van dat land). Zelfde inhoud als het oude scherm (`app/src/trips/category-routes.js`).
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import ConfirmDialog from '../../components/confirm-dialog.vue';
import FormField from '../../components/form-field.vue';
import PhotoPicker from '../../components/photo-picker.vue';
import SaveBar from '../../components/save-bar.vue';
import StatusMessage from '../../components/status-message.vue';
import { ApiError } from '../../api/client';
import { setPageTitle } from '../../shell/page-title';
import CategoryFields from './category-fields.vue';
import { categoryFormOf, categoryInputOf, emptyCategoryForm } from './category-form';
import { categoryApi as defaultApi, NOTICES, type CategoryApi, type CategoryDetails, type CategoryOverview } from './category-api';

const props = defineProps<{
  /** Id van het reistype of land. */
  id: number;
  /** Functies voor de API (tests geven een eigen versie mee). */
  categories?: CategoryApi;
}>();
const categories = props.categories || defaultApi;
const route = useRoute();
const router = useRouter();

/** Soortnaam per soort, voor het blok Gebruik. */
const KIND_LABELS: Record<string, string> = { type: 'Reistype', bestemming: 'Land', overig: 'Overig' };

const category = ref<CategoryDetails | null>(null);
const overview = ref<CategoryOverview | null>(null);
const form = ref(emptyCategoryForm());
const errors = ref<Record<string, string>>({});
const formError = ref('');
const loadError = ref('');
const notice = ref(NOTICES[String(route.query.melding || '')] || '');
const missing = ref(false);
const busy = ref(false);
const confirmRemove = ref(false);
const confirmMerge = ref(false);
const mergeTarget = ref('');
const mergeError = ref('');
const photoId = ref<number | null>(null);
const photoError = ref('');
const allCountries = ref(false);

/** Wordt het reistype of land ergens gebruikt (dan kan alleen samenvoegen). */
const used = computed(() => Boolean(category.value && (category.value.reizen > 0 || category.value.fotos > 0)));

/** Naam van de gekozen categorie om mee samen te voegen. */
const mergeName = computed(() => category.value?.samenvoegenMet.find((other) => String(other.id) === mergeTarget.value)?.naam || '');

/**
 * Laadt een pagina foto's voor de kiezer (bij een land standaard alleen de foto's van dat land).
 * @param query Zoektekst en pagina.
 * @returns De foto's.
 */
const loadPhotos = (query: { text: string; page: number }) => categories.photos(props.id, { ...query, all: allCountries.value });

/**
 * Laadt het reistype of land (en het overzicht voor soorten, iconen en grenzen).
 * @returns Klaar.
 */
async function load(): Promise<void> {
  try {
    const [details, all] = await Promise.all([categories.category(props.id), overview.value ? Promise.resolve(overview.value) : categories.overview()]);
    category.value = details;
    overview.value = all;
    form.value = categoryFormOf(details);
    setPageTitle(details.naam);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) missing.value = true;
    else loadError.value = error instanceof ApiError ? error.message : 'Het reistype of land kon niet worden geladen.';
  }
}

/**
 * Begint een actie: bezig, meldingen leeg.
 */
function start(): void {
  busy.value = true;
  notice.value = '';
  formError.value = '';
  mergeError.value = '';
  photoError.value = '';
}

/**
 * Toont een fout van de server bij een actie; een 404 betekent dat het reistype of land weg is.
 * @param error De fout.
 * @param show Zet de melding op de juiste plek.
 */
function showError(error: unknown, show: (message: string) => void): void {
  if (error instanceof ApiError && error.status === 404) {
    missing.value = true;
    return;
  }
  show(error instanceof ApiError ? error.message : 'Dat lukte niet.');
}

/** Slaat de velden op en laadt opnieuw (met een melding als het adres is gewijzigd). */
async function save(): Promise<void> {
  start();
  errors.value = {};
  try {
    const result = await categories.update(props.id, categoryInputOf(form.value));
    await load();
    notice.value = NOTICES[result.verplaatst ? 'verplaatst' : 'opgeslagen']!;
  } catch (error) {
    errors.value = error instanceof ApiError ? error.fields : {};
    showError(error, (message) => { formError.value = message; });
  }
  busy.value = false;
}

/** Verwijdert na bevestigen en gaat terug naar het overzicht. */
async function remove(): Promise<void> {
  confirmRemove.value = false;
  start();
  try {
    await categories.remove(props.id);
    await router.push({ path: '/', query: { melding: 'weg' } });
  } catch (error) {
    showError(error, (message) => { formError.value = message; });
  }
  busy.value = false;
}

/** Voegt na bevestigen samen en opent de categorie die blijft. */
async function merge(): Promise<void> {
  confirmMerge.value = false;
  start();
  try {
    const result = await categories.merge(props.id, Number(mergeTarget.value));
    // Zelfde scherm met een ander id: de watcher op `id` laadt de categorie die blijft.
    await router.push({ path: `/${result.doelId}/` });
    notice.value = NOTICES.samengevoegd!;
  } catch (error) {
    showError(error, (message) => { mergeError.value = message; });
  }
  busy.value = false;
}

/**
 * Zet de gekozen foto, of geen foto.
 * @param chosen Id van de foto, of null.
 */
async function savePhoto(chosen: number | null): Promise<void> {
  start();
  try {
    const result = await categories.setPhoto(props.id, chosen);
    if (category.value) category.value.foto = result.foto;
    photoId.value = null;
    notice.value = 'De foto is opgeslagen.';
  } catch (error) {
    showError(error, (message) => { photoError.value = message; });
  }
  busy.value = false;
}

/** Kiest samenvoegen: eerst een categorie, dan bevestigen. */
function askMerge(): void {
  mergeError.value = mergeTarget.value ? '' : 'Kies met welke categorie je wilt samenvoegen.';
  if (mergeTarget.value) confirmMerge.value = true;
}

// Na samenvoegen opent het scherm een ander id; laad dan opnieuw.
watch(() => props.id, () => {
  missing.value = false;
  mergeTarget.value = '';
  void load();
});

onMounted(async () => {
  if (route.query.melding) void router.replace({ query: {} });
  await load();
});
</script>

<template>
  <div>
    <p>
      <RouterLink to="/">
        Naar reistypes en landen
      </RouterLink>
      <template v-if="category">
        · <a :href="category.pad">Bekijk op de site</a>
      </template>
    </p>
    <StatusMessage
      kind="succes"
      :message="notice"
      dismissible
      @dismiss="notice = ''"
    />
    <p v-if="missing">
      Dit reistype of land bestaat niet (meer).
    </p>
    <StatusMessage
      v-else-if="loadError"
      kind="fout"
      :message="loadError"
    />
    <p
      v-else-if="!category || !overview"
      class="crm-empty"
    >
      Laden…
    </p>
    <template v-else>
      <div class="crm-columns">
        <section>
          <form
            novalidate
            @submit.prevent="save"
          >
            <div class="form crm-narrow">
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
            </div>
            <SaveBar
              label="Opslaan"
              :busy="busy"
            >
              <template #links>
                <button
                  v-if="!used"
                  class="btn btn--outline"
                  type="button"
                  :disabled="busy"
                  @click="confirmRemove = true"
                >
                  Verwijderen
                </button>
                <span
                  v-else
                  class="crm-savebar-note"
                >Verwijderen kan als er geen reizen en foto's aan hangen; voeg een dubbeling samen.</span>
              </template>
            </SaveBar>
          </form>
        </section>
        <section>
          <h2>Gebruik</h2>
          <dl class="crm-facts">
            <dt>Soort</dt>
            <dd>{{ KIND_LABELS[category.soort] || category.soort }}</dd>
            <template v-if="category.code">
              <dt>Landcode (ISO)</dt>
              <dd>{{ category.code }}</dd>
            </template>
            <dt>Reizen</dt>
            <dd>{{ category.reizen }}</dd>
            <dt>Foto's in de bibliotheek</dt>
            <dd>
              <a
                v-if="category.soort === 'bestemming' && category.fotos"
                :href="`/app/fotobibliotheek/?land=${category.id}`"
              >{{ category.fotos }}</a>
              <template v-else>
                {{ category.fotos }}
              </template>
            </dd>
            <dt>Adres</dt>
            <dd><code>{{ category.pad }}</code></dd>
          </dl>
          <h2>Samenvoegen</h2>
          <form
            class="form crm-block"
            novalidate
            @submit.prevent="askMerge"
          >
            <p>
              Is dit een dubbeling? Dan gaan de reizen en foto's naar een categorie van dezelfde soort, verdwijnt deze en
              verwijst het adres <code>{{ category.pad }}</code> door.
            </p>
            <FormField
              v-slot="field"
              label="Samenvoegen met"
              :error="mergeError"
            >
              <select
                :id="field.id"
                v-model="mergeTarget"
                :aria-describedby="field.describedBy"
                :aria-invalid="field.invalid"
              >
                <option value="">
                  Kies…
                </option>
                <option
                  v-for="other in category.samenvoegenMet"
                  :key="other.id"
                  :value="String(other.id)"
                >
                  {{ other.naam }} ({{ other.adres }})
                </option>
              </select>
            </FormField>
            <div>
              <button
                class="btn btn--small btn--outline"
                type="submit"
                :disabled="busy"
              >
                Samenvoegen
              </button>
            </div>
          </form>
        </section>
      </div>
      <section
        id="foto"
        class="crm-block"
      >
        <h2>Foto</h2>
        <img
          v-if="category.foto && category.foto.startsWith('/')"
          class="media-preview media-preview--small"
          :src="category.foto"
          alt=""
          width="400"
          height="300"
        >
        <p v-else>
          Nog geen foto gekozen.
        </p>
        <p class="field__help">
          Kies een foto uit de fotobibliotheek{{ category.soort === 'bestemming' ? ' (standaard de foto\'s van dit land)' : '' }}.
          Deze foto staat bovenaan de pagina van {{ category.naam }} en op de homepage.
        </p>
        <StatusMessage
          kind="fout"
          :message="photoError"
        />
        <div
          v-if="category.soort === 'bestemming'"
          class="field field--checkbox"
        >
          <label><input
            v-model="allCountries"
            type="checkbox"
          > Foto's van alle landen tonen</label>
        </div>
        <PhotoPicker
          :key="allCountries ? 'alle' : 'land'"
          v-model="photoId"
          label="Kies een foto"
          :load="loadPhotos"
        />
        <p class="crm-actions">
          <button
            class="btn btn--small"
            type="button"
            :disabled="busy || photoId === null"
            @click="savePhoto(photoId)"
          >
            Deze foto gebruiken
          </button>
          <button
            v-if="category.foto"
            class="btn btn--small btn--outline"
            type="button"
            :disabled="busy"
            @click="savePhoto(null)"
          >
            Geen foto
          </button>
        </p>
      </section>
      <ConfirmDialog
        :open="confirmRemove"
        title="Verwijderen?"
        :message="`${category.naam} verdwijnt. Dit kun je niet ongedaan maken.`"
        confirm-label="Verwijderen"
        danger
        @confirm="remove"
        @cancel="confirmRemove = false"
      />
      <ConfirmDialog
        :open="confirmMerge"
        title="Samenvoegen?"
        :message="`De reizen en foto's van ${category.naam} gaan naar ${mergeName}; ${category.naam} verdwijnt en het adres verwijst door. Dit kun je niet ongedaan maken.`"
        confirm-label="Samenvoegen"
        danger
        @confirm="merge"
        @cancel="confirmMerge = false"
      />
    </template>
  </div>
</template>

<!--
  De kop van één lijstpagina (`/app/lijstpaginas/<sleutel>/`): pretitel, titel en inleiding met de knoppenbalk, en de
  foto met een link naar de fotokiezer. Zelfde inhoud als het oude scherm (`app/src/cms/list-header-routes.js`).
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import SaveBar from '../../components/save-bar.vue';
import StatusMessage from '../../components/status-message.vue';
import TextField from '../../components/text-field.vue';
import { ApiError } from '../../api/client';
import { setPageTitle } from '../../shell/page-title';
import { listHeaderApi as defaultApi, NOTICES, type ListHeader, type ListHeaderApi, type ListHeaderLimits } from './list-header-api';

const props = defineProps<{
  /** Sleutel van de lijstpagina. */
  sleutel: string;
  /** Functies voor de API (tests geven een eigen versie mee). */
  headers?: ListHeaderApi;
}>();
const headers = props.headers || defaultApi;
const route = useRoute();
const router = useRouter();

const header = ref<ListHeader | null>(null);
const limits = ref<ListHeaderLimits>({ pretitel: 120, titel: 120, inleiding: 400 });
const pretitle = ref('');
const title = ref('');
const intro = ref('');
const errors = ref<Record<string, string>>({});
const formError = ref('');
const loadError = ref('');
const notice = ref(NOTICES[String(route.query.melding || '')] || '');
const busy = ref(false);

/** Deze pagina's tonen geen inleiding (gelijk aan het oude scherm). */
const introHelp = computed(() => (props.sleutel === 'reis' || props.sleutel === 'faq' ? 'Deze pagina toont geen inleiding; de tekst wordt wel bewaard.' : ''));

/**
 * Zet de velden op de kop van de server.
 * @param value De kop.
 */
function fill(value: ListHeader): void {
  header.value = value;
  pretitle.value = value.pretitel;
  title.value = value.titel;
  intro.value = value.inleiding;
}

/** Slaat de teksten op; bij een fout blijven de velden staan met de melding per veld. */
async function save(): Promise<void> {
  busy.value = true;
  errors.value = {};
  formError.value = '';
  notice.value = '';
  try {
    fill(await headers.update(props.sleutel, { pretitel: pretitle.value, titel: title.value, inleiding: intro.value }));
    notice.value = NOTICES.opgeslagen!;
  } catch (error) {
    errors.value = error instanceof ApiError ? error.fields : {};
    formError.value = error instanceof ApiError ? error.message : 'Dat lukte niet.';
  }
  busy.value = false;
}

onMounted(async () => {
  // De melding hoort bij de wissel hiernaartoe; bij herladen hoeft hij niet terug te komen.
  if (route.query.melding) void router.replace({ query: {}, hash: route.hash });
  try {
    const [value, overview] = await Promise.all([headers.header(props.sleutel), headers.overview()]);
    limits.value = overview.grenzen;
    fill(value);
    setPageTitle(`Lijstpagina: ${value.naam}`);
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'De lijstpagina kon niet worden geladen.';
  }
});
</script>

<template>
  <div>
    <p>
      <RouterLink to="/">
        Terug naar de lijstpagina's
      </RouterLink>
      <template v-if="header?.pad">
        · <a :href="header.pad">Bekijk op de site</a>
      </template>
    </p>
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
      v-if="!header && !loadError"
      class="crm-empty"
    >
      Laden…
    </p>
    <template v-if="header">
      <form
        id="kop"
        novalidate
        @submit.prevent="save"
      >
        <div class="form crm-block crm-narrow">
          <h2>Kop</h2>
          <StatusMessage
            kind="fout"
            :message="formError"
          />
          <TextField
            v-model="pretitle"
            label="Pretitel"
            help="Kleine regel boven de titel."
            :maxlength="limits.pretitel"
            :error="errors.pretitel"
          />
          <TextField
            v-model="title"
            label="Titel"
            :maxlength="limits.titel"
            :error="errors.titel"
            required
          />
          <TextField
            v-model="intro"
            label="Inleiding"
            multiline
            :help="introHelp"
            :maxlength="limits.inleiding"
            :error="errors.inleiding"
          />
        </div>
        <SaveBar
          label="Opslaan"
          :busy="busy"
        />
      </form>
      <section
        id="foto"
        class="crm-block"
      >
        <h2>Foto</h2>
        <img
          v-if="header.foto && header.foto.startsWith('/')"
          class="media-preview media-preview--small"
          :src="header.foto"
          alt=""
          width="400"
          height="300"
        >
        <p v-else>
          Nog geen foto; de kop toont dan alleen de tekst.
        </p>
        <p>
          <RouterLink :to="`/${header.sleutel}/foto/`">
            {{ header.foto ? 'Andere foto kiezen' : 'Foto kiezen' }}
          </RouterLink>
        </p>
      </section>
    </template>
  </div>
</template>

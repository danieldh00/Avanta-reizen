<!--
  De foto van een lijstpagina kiezen (`/app/lijstpaginas/<sleutel>/foto/`): de fotokiezer met zoeken en bladeren, een
  foto gebruiken of de foto weghalen. Na opslaan terug naar de kop met een melding. Zelfde inhoud als het oude scherm
  (`app/src/cms/list-header-routes.js`).
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import PhotoPicker from '../../components/photo-picker.vue';
import StatusMessage from '../../components/status-message.vue';
import { ApiError } from '../../api/client';
import { setPageTitle } from '../../shell/page-title';
import { listHeaderApi as defaultApi, type ListHeader, type ListHeaderApi } from './list-header-api';

const props = defineProps<{
  /** Sleutel van de lijstpagina. */
  sleutel: string;
  /** Functies voor de API (tests geven een eigen versie mee). */
  headers?: ListHeaderApi;
}>();
const headers = props.headers || defaultApi;
const router = useRouter();

const header = ref<ListHeader | null>(null);
const photoId = ref<number | null>(null);
const error = ref('');
const loadError = ref('');
const busy = ref(false);

/**
 * Laadt een pagina foto's voor de kiezer.
 * @param query Zoektekst en pagina.
 * @returns De foto's.
 */
const loadPhotos = (query: { text: string; page: number }) => headers.photos(props.sleutel, query);

/**
 * Zet de gekozen foto, of geen foto, en gaat terug naar de kop.
 * @param chosen Id van de foto, of null.
 */
async function save(chosen: number | null): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await headers.setPhoto(props.sleutel, chosen);
    await router.push({ path: `/${props.sleutel}/`, query: { melding: 'foto' }, hash: '#foto' });
  } catch (failure) {
    error.value = failure instanceof ApiError ? failure.message : 'Dat lukte niet.';
  }
  busy.value = false;
}

onMounted(async () => {
  try {
    header.value = await headers.header(props.sleutel);
    setPageTitle(`Foto: ${header.value.naam}`);
  } catch (failure) {
    loadError.value = failure instanceof ApiError ? failure.message : 'De lijstpagina kon niet worden geladen.';
  }
});
</script>

<template>
  <div>
    <p>
      <RouterLink :to="{ path: `/${sleutel}/`, hash: '#foto' }">
        Terug naar {{ header?.naam || 'de lijstpagina' }}
      </RouterLink>
    </p>
    <StatusMessage
      kind="fout"
      :message="loadError"
    />
    <section
      v-if="header"
      id="foto"
      class="crm-block"
    >
      <StatusMessage
        kind="fout"
        :message="error"
      />
      <PhotoPicker
        v-model="photoId"
        label="Kies een foto"
        :load="loadPhotos"
      />
      <p class="crm-actions">
        <button
          class="btn btn--small"
          type="button"
          :disabled="busy || photoId === null"
          @click="save(photoId)"
        >
          Deze foto gebruiken
        </button>
        <button
          v-if="header.foto"
          class="btn btn--small btn--outline"
          type="button"
          :disabled="busy"
          @click="save(null)"
        >
          Geen foto
        </button>
      </p>
    </section>
  </div>
</template>

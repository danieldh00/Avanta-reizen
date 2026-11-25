<!--
  Melding na een actie (opgeslagen, mislukt, let op), met de klassen van de bestaande schermen: `notice` voor een
  bevestiging of informatie, `form-alert` voor een fout. Een fout wordt meteen voorgelezen (`role="alert"`), de rest
  beleefd (`role="status"`). Met `dismissible` een knop om de melding weg te halen.
-->
<script setup lang="ts">
const props = defineProps<{
  /** Soort: `succes`, `info` of `fout`. */
  kind: 'succes' | 'info' | 'fout';
  /** De melding. */
  message: string;
  dismissible?: boolean;
}>();

const emit = defineEmits<{ dismiss: [] }>();
</script>

<template>
  <div
    v-if="props.message"
    :class="[kind === 'fout' ? 'form-alert' : 'notice', 'crm-message-box']"
    :role="kind === 'fout' ? 'alert' : 'status'"
  >
    <span>{{ message }}</span>
    <button
      v-if="dismissible"
      class="btn btn--small btn--outline"
      type="button"
      @click="emit('dismiss')"
    >
      Sluiten<span class="visually-hidden"> melding</span>
    </button>
  </div>
</template>

<style>
.crm-message-box { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 0 0 1rem; }
</style>

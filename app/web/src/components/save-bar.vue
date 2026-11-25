<!--
  Opslaanbalk onder een bewerkformulier, gelijk aan `renderSaveBar` uit `app/src/crm/ui.js`: blijft onderaan in beeld
  (sticky, `crm.css`), met een korte toelichting en de knop. Tijdens het opslaan is de knop uitgeschakeld en meldt hij
  dat (ook aan schermlezers).
-->
<script setup lang="ts">
defineProps<{
  /** Tekst op de knop. */
  label: string;
  /** Korte toelichting links (verdwijnt op een smal scherm). */
  note?: string;
  /** Bezig met opslaan. */
  busy?: boolean;
}>();
</script>

<template>
  <div class="crm-savebar">
    <span class="crm-savebar-note">{{ note || '' }}</span>
    <button
      class="btn"
      type="submit"
      :disabled="busy"
      :aria-busy="busy ? 'true' : undefined"
    >
      {{ busy ? 'Bezig met opslaan…' : label }}
    </button>
  </div>
</template>

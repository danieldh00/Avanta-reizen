<!--
  Eén formulierveld met label, hulptekst en foutmelding, gelijk aan `renderInput` uit `app/src/crm/layout.js` (klassen
  `field`, `field__label`, `field__help`, `field__error`). Het invoerelement zelf staat in de standaardslot en krijgt
  via de slot-eigenschappen het id, `aria-describedby` en `aria-invalid`, zodat label, hulp en fout altijd gekoppeld
  zijn.
-->
<script setup lang="ts">
import { computed, useId } from 'vue';

const props = defineProps<{
  label: string;
  /** Hulptekst onder het label. */
  help?: string;
  /** Foutmelding (van de server, `ApiError.fields`). */
  error?: string;
  /** Verplicht veld (sterretje bij het label). */
  required?: boolean;
}>();

const id = useId();
const helpId = `${id}-hulp`;
const errorId = `${id}-fout`;
const describedBy = computed(() => [props.help ? helpId : '', props.error ? errorId : ''].filter(Boolean).join(' ') || undefined);
</script>

<template>
  <div class="field">
    <span class="field__label">
      <label :for="id">{{ label }}</label>
      <span
        v-if="required"
        class="required"
        aria-hidden="true"
      > *</span>
    </span>
    <span
      v-if="help"
      :id="helpId"
      class="field__help"
    >{{ help }}</span>
    <slot
      :id="id"
      :described-by="describedBy"
      :invalid="error ? true : undefined"
    />
    <span
      v-if="error"
      :id="errorId"
      class="field__error"
    >{{ error }}</span>
  </div>
</template>

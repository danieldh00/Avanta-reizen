<!--
  Zoekveld boven een lijst, gelijk aan `renderSearch` uit `app/src/crm/ui.js`: label, zoekveld (hoogstens 100 tekens)
  en een knop. Zoeken gebeurt bij het versturen (Enter of de knop), niet bij elke toets.
-->
<script setup lang="ts">
import { ref, watch, useId } from 'vue';

const props = defineProps<{
  /** De huidige zoekterm. */
  modelValue: string;
  /** Label van het veld. */
  label: string;
  /** Tekst op de knop (standaard `Zoeken`). */
  submitLabel?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const id = useId();
const text = ref(props.modelValue);
watch(() => props.modelValue, (value) => { text.value = value; });

/** Geeft de (ingekorte) zoekterm door. */
function submit(): void {
  emit('update:modelValue', text.value.trim().slice(0, 100));
}
</script>

<template>
  <form
    class="crm-search"
    role="search"
    @submit.prevent="submit"
  >
    <label :for="id">{{ label }}</label>
    <input
      :id="id"
      v-model="text"
      type="search"
      maxlength="100"
    >
    <slot />
    <button
      class="btn btn--small btn--outline"
      type="submit"
    >
      {{ submitLabel || 'Zoeken' }}
    </button>
  </form>
</template>

<!--
  Tekstveld (een regel of meerdere) op `form-field.vue`, met `v-model`.
-->
<script setup lang="ts">
import FormField from './form-field.vue';

defineProps<{
  label: string;
  /** Soort veld voor één regel (standaard `text`). */
  type?: 'text' | 'email' | 'url' | 'tel' | 'number' | 'date' | 'search' | 'password';
  /** Meerdere regels (een tekstvak). */
  multiline?: boolean;
  help?: string;
  error?: string;
  required?: boolean;
  maxlength?: number;
  autocomplete?: string;
}>();

const model = defineModel<string>({ default: '' });
</script>

<template>
  <FormField
    v-slot="field"
    :label="label"
    :help="help"
    :error="error"
    :required="required"
  >
    <textarea
      v-if="multiline"
      :id="field.id"
      v-model="model"
      :maxlength="maxlength"
      :required="required"
      :aria-describedby="field.describedBy"
      :aria-invalid="field.invalid"
      rows="5"
    />
    <input
      v-else
      :id="field.id"
      v-model="model"
      :type="type || 'text'"
      :maxlength="maxlength"
      :required="required"
      :autocomplete="autocomplete"
      :aria-describedby="field.describedBy"
      :aria-invalid="field.invalid"
    >
  </FormField>
</template>

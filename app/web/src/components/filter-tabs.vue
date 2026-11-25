<!--
  Filter als rij tabbladen boven een lijst, gelijk aan `renderFilterTabs` uit `app/src/crm/ui.js`. Elk tabblad is een
  gewone link met de filter in het adres (werkt ook met een nieuw tabblad of een bladwijzer); een gewone klik wisselt
  zonder te herladen via `update:modelValue`. De overige parameters van het adres (zoekterm, sortering) geeft de ouder
  mee in `query`, zodat de links ook na zoeken of bladeren zonder herladen kloppen; zonder `query` gelden de
  parameters van het adres op het moment van tekenen.
-->
<script setup lang="ts">
/** Eén keuze in het filter. */
export interface FilterOption {
  value: string;
  label: string;
  /** Aantal naast de keuze (optioneel). */
  count?: number;
}

const props = defineProps<{
  options: FilterOption[];
  /** De gekozen waarde. */
  modelValue: string;
  /** Naam van de parameter in het adres (bijvoorbeeld `status`). */
  name: string;
  /** Omschrijving voor schermlezers. */
  label?: string;
  /** Overige parameters van de lijst (zoals `q`); de filter zelf en `pagina` worden genegeerd. */
  query?: Record<string, string>;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

/**
 * Adres van een keuze: het huidige pad met de filter als parameter (leeg = zonder parameter).
 * @param value Waarde.
 * @returns Adres.
 */
function hrefFor(value: string): string {
  const params = new URLSearchParams(props.query || window.location.search);
  if (value) params.set(props.name, value);
  else params.delete(props.name);
  params.delete('pagina');
  const query = params.toString();
  return query ? `?${query}` : window.location.pathname;
}

/**
 * Kiest een waarde bij een gewone klik; met Ctrl, Cmd, Shift of de middelste knop opent de browser de link zelf.
 * @param event Klik.
 * @param value Waarde.
 */
function choose(event: MouseEvent, value: string): void {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  emit('update:modelValue', value);
}
</script>

<template>
  <nav
    class="crm-tabs"
    :aria-label="label || 'Filter'"
  >
    <ul>
      <li
        v-for="option in options"
        :key="option.value"
      >
        <a
          :href="hrefFor(option.value)"
          :aria-current="option.value === modelValue ? 'true' : undefined"
          @click="choose($event, option.value)"
        >
          {{ option.label }}
          <span
            v-if="Number.isInteger(option.count)"
            class="crm-tabs-count"
          >{{ option.count }}</span>
        </a>
      </li>
    </ul>
  </nav>
</template>

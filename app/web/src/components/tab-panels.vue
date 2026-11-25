<!--
  Tabbladen op een bewerkscherm, gelijk aan `renderTabNav`/`renderTabPanel` uit `app/src/crm/ui.js` en het gedrag van
  `public/js/crm.js`: één paneel tegelijk zichtbaar, het tabblad van het open paneel gemarkeerd, een tabblad met een
  fout krijgt een stip. De inhoud per paneel staat in de slot `tab-<sleutel>`. Alle panelen blijven in de pagina
  (verborgen), zodat de velden van een formulier over meerdere panelen samen verstuurd worden. Weigert de browser het
  versturen omdat een veld in een verborgen paneel ongeldig is (`invalid`), dan gaat het paneel met het eerste
  ongeldige veld open, zodat de gebruiker ziet wat er mis is.
-->
<script setup lang="ts">
import { computed } from 'vue';

/** Eén tabblad. */
export interface TabItem {
  /** Sleutel: kleine letters, cijfers en streepjes. */
  key: string;
  label: string;
  /** Aantal naast het label (optioneel). */
  count?: number;
  /** Er staat een fout in dit paneel. */
  error?: boolean;
}

const props = defineProps<{
  tabs: TabItem[];
  /** Sleutel van het open paneel; standaard het eerste. */
  modelValue?: string;
  /** Omschrijving voor schermlezers. */
  label?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [key: string] }>();

const KEY = /^[a-z0-9-]{1,40}$/;
const validTabs = computed(() => props.tabs.filter((tab) => KEY.test(tab.key)));
const active = computed(() => (validTabs.value.some((tab) => tab.key === props.modelValue) ? props.modelValue : validTabs.value[0]?.key));

/**
 * Een ongeldig veld bij het versturen: open het paneel waarin het staat, als dat verborgen is. Alleen het eerste
 * ongeldige veld in de volgorde van de pagina telt (dat veld krijgt ook de focus van de browser); de browser stuurt
 * `invalid` per veld vanuit een eigen taak, dus een vlag tussen de events werkt niet.
 * @param event Het `invalid`-event (opgevangen in de capture-fase, want het bubbelt niet).
 */
function onInvalid(event: Event): void {
  const root = event.currentTarget;
  if (!(event.target instanceof Element) || !(root instanceof Element) || root.querySelector(':invalid') !== event.target) return;
  const panel = event.target.closest('.crm-tabpanel');
  const key = panel?.id.replace(/^tab-/, '');
  if (!key || key === active.value || !validTabs.value.some((tab) => tab.key === key)) return;
  emit('update:modelValue', key);
}
</script>

<template>
  <div
    class="crm-tabbed crm-tabbed--js"
    @invalid.capture="onInvalid"
  >
    <nav
      class="crm-tabs crm-tabs--edit"
      :aria-label="label || 'Onderdelen'"
    >
      <ul>
        <li
          v-for="tab in validTabs"
          :key="tab.key"
        >
          <a
            :href="`#tab-${tab.key}`"
            :class="{ 'crm-tabs-error': tab.error }"
            :aria-current="tab.key === active ? 'true' : undefined"
            @click.prevent="emit('update:modelValue', tab.key)"
          >
            {{ tab.label }}
            <span
              v-if="Number.isInteger(tab.count)"
              class="crm-tabs-count"
            >{{ tab.count }}</span>
            <span
              v-if="tab.error"
              class="visually-hidden"
            >(bevat een fout)</span>
          </a>
        </li>
      </ul>
    </nav>
    <div
      v-for="tab in validTabs"
      :id="`tab-${tab.key}`"
      :key="tab.key"
      class="crm-tabpanel"
      :hidden="tab.key !== active"
    >
      <slot :name="`tab-${tab.key}`" />
    </div>
  </div>
</template>

<!--
  De velden van een menu-item, gedeeld door het overzicht (nieuw item) en het bewerkscherm: menu, bovenliggend item
  (alleen hoofdmenu), tekst, adres (met suggesties) en volgorde. Gelijk aan `renderItemFields` van het oude scherm
  (`app/src/cms/menu-routes.js`).
-->
<script setup lang="ts">
import { computed } from 'vue';
import FormField from '../../components/form-field.vue';
import TextField from '../../components/text-field.vue';
import type { MenuGroup, MenuLimits, PathSuggestion } from './menu-api';
import type { MenuItemForm } from './menu-form';

const props = defineProps<{
  /** Alle menu's met hun items (voor de keuze van het bovenliggende item). */
  menus: MenuGroup[];
  suggestions: PathSuggestion[];
  limits: MenuLimits;
  /** Id van het item zelf (dat kan niet onder zichzelf); null bij een nieuw item. */
  selfId: number | null;
  /** Meldingen per veld van de server. */
  errors: Record<string, string>;
  /** Uniek voorvoegsel voor de lijst met suggesties. */
  prefix: string;
}>();

const form = defineModel<MenuItemForm>({ required: true });

/** Hoofditems van het hoofdmenu, behalve het item zelf. */
const parents = computed(() => (props.menus.find((group) => group.menu === 'hoofd')?.items || [])
  .filter((item) => item.ouderId === null && item.id !== props.selfId));
</script>

<template>
  <FormField
    v-slot="field"
    label="Menu"
    :error="errors.menu"
  >
    <select
      :id="field.id"
      v-model="form.menu"
      :aria-describedby="field.describedBy"
      :aria-invalid="field.invalid"
    >
      <option
        v-for="group in menus"
        :key="group.menu"
        :value="group.menu"
      >
        {{ group.naam }}
      </option>
    </select>
  </FormField>
  <FormField
    v-slot="field"
    label="Onder item (submenu, alleen hoofdmenu)"
    :error="errors.ouderId"
  >
    <select
      :id="field.id"
      v-model="form.ouderId"
      :aria-describedby="field.describedBy"
      :aria-invalid="field.invalid"
    >
      <option value="">
        Geen (hoofditem)
      </option>
      <option
        v-for="parent in parents"
        :key="parent.id"
        :value="String(parent.id)"
      >
        {{ parent.tekst }}
      </option>
    </select>
  </FormField>
  <TextField
    v-model="form.tekst"
    label="Tekst"
    :maxlength="limits.tekst"
    :error="errors.tekst"
    required
  />
  <FormField
    v-slot="field"
    label="Adres"
    help="Een pad op deze site (bijv. /reis/ of /avanta-reizen/voorpret/) of een https-adres."
    :error="errors.adres"
    required
  >
    <input
      :id="field.id"
      v-model="form.adres"
      type="text"
      :maxlength="limits.adres"
      :list="`${prefix}-paden`"
      required
      :aria-describedby="field.describedBy"
      :aria-invalid="field.invalid"
    >
    <datalist :id="`${prefix}-paden`">
      <option
        v-for="suggestion in suggestions"
        :key="suggestion.pad"
        :value="suggestion.pad"
      >
        {{ suggestion.titel }}
      </option>
    </datalist>
  </FormField>
  <TextField
    v-model="form.volgorde"
    label="Volgorde"
    type="number"
    help="Lager staat eerder; bijv. 10, 20, 30."
    :error="errors.volgorde"
  />
</template>

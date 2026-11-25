<!--
  De velden van een reistype of land, gedeeld door het overzicht (nieuw) en het bewerkscherm: naam, slug, soort,
  icoon, inleiding, tekst (teksteditor), volgorde en tonen op de homepage. Gelijk aan de velden van het oude scherm
  (`app/src/trips/category-routes.js`).
-->
<script setup lang="ts">
import FormField from '../../components/form-field.vue';
import RichTextEditor from '../../components/rich-text-editor.vue';
import TextField from '../../components/text-field.vue';
import type { CategoryKindInfo, CategoryLimits } from './category-api';
import type { CategoryForm } from './category-form';

defineProps<{
  kinds: CategoryKindInfo[];
  /** Namen van de iconen die een reistype kan krijgen. */
  icons: string[];
  limits: CategoryLimits;
  /** Meldingen per veld van de server. */
  errors: Record<string, string>;
}>();

const form = defineModel<CategoryForm>({ required: true });

/** Hulptekst bij de teksteditor (gelijk aan `RICHTEXT_HELP` van de server). */
const RICHTEXT_HELP = 'Typ de tekst zoals hij op de site komt: Enter begint een nieuwe alinea, Shift+Enter een nieuwe regel. Kopjes, vet, cursief, lijsten en links maak je met de knoppen boven het vak; met HTML zie en wijzig je de code. Andere opmaak, scripts en stijlen verdwijnen bij het opslaan.';
</script>

<template>
  <TextField
    v-model="form.naam"
    label="Naam"
    :maxlength="limits.naam"
    :error="errors.naam"
    required
  />
  <TextField
    v-model="form.adres"
    label="Slug (deel van het adres; leeg = uit de naam)"
    :maxlength="80"
    help="Wijzig je de slug, dan verwijst het oude adres automatisch door (301)."
    :error="errors.adres"
  />
  <FormField
    v-slot="field"
    label="Soort"
    :error="errors.soort"
  >
    <select
      :id="field.id"
      v-model="form.soort"
      :aria-describedby="field.describedBy"
      :aria-invalid="field.invalid"
    >
      <option
        v-for="kind in kinds"
        :key="kind.soort"
        :value="kind.soort"
      >
        {{ kind.naam }}
      </option>
    </select>
  </FormField>
  <FormField
    v-slot="field"
    label="Icoon (voor reistypes)"
    :error="errors.icoon"
  >
    <select
      :id="field.id"
      v-model="form.icoon"
      :aria-describedby="field.describedBy"
      :aria-invalid="field.invalid"
    >
      <option value="">
        Automatisch (op de slug)
      </option>
      <option
        v-for="name in icons"
        :key="name"
        :value="name"
      >
        {{ name }}
      </option>
    </select>
  </FormField>
  <TextField
    v-model="form.inleiding"
    label="Inleiding"
    multiline
    :maxlength="limits.inleiding"
    :error="errors.inleiding"
  />
  <RichTextEditor
    v-model="form.tekst"
    label="Tekst"
    :help="RICHTEXT_HELP"
    :maxlength="limits.tekst"
    :error="errors.tekst"
  />
  <TextField
    v-model="form.volgorde"
    label="Volgorde (laag eerst)"
    type="number"
    :error="errors.volgorde"
  />
  <div class="field field--checkbox">
    <label><input
      v-model="form.homepage"
      type="checkbox"
    > Tonen op de homepage</label>
    <span class="field__help">Reistypes: staat er minstens één aan, dan toont de homepage alleen die, op volgorde. Landen: idem voor de bestemmingen.</span>
  </div>
</template>

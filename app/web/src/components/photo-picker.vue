<!--
  Foto kiezen uit de fotobibliotheek, gelijk aan de kiezer van de bewerkschermen (`app/src/media/picker.js`, klassen
  `media-grid`, `media-pick`): zoeken, foto's als keuzerondjes (één foto) of vinkjes (`multiple`), bladeren en eventueel
  *Geen foto*. `v-model` is het gekozen id (of de lijst met id's). Zoeken staat niet in een eigen `<form>`, zodat de
  kiezer ook binnen het formulier van een bewerkscherm kan staan.

  Het component haalt zelf niets op: het scherm geeft `load` mee (een functie die via `api` de foto's van een pagina
  ophaalt), zodat de kiezer in elke module werkt en de server het recht en de koppeling blijft controleren. Alleen
  adressen op de eigen site (`/…`) komen in een `<img>`.
-->
<script setup lang="ts">
import { onMounted, ref, useId } from 'vue';
import PagerNav from './pager-nav.vue';
import StatusMessage from './status-message.vue';
import { ApiError } from '../api/client';

/** Eén foto in de kiezer. */
export interface PickerPhoto {
  id: number;
  /** Adres van een kleine variant (`/media/…`). */
  url: string;
  title: string;
  /** Alternatieve tekst. */
  alt: string;
  /** Regel onder de titel, bijvoorbeeld de landen. */
  meta?: string;
  width?: number;
  height?: number;
}

/** Wat `load` teruggeeft: de foto's van de pagina en of er een volgende is. */
export interface PickerPage {
  photos: PickerPhoto[];
  hasMore: boolean;
}

const props = defineProps<{
  /** Kop van de kiezer (legenda van de groep). */
  label: string;
  /** Haalt een pagina foto's op. */
  load: (query: { text: string; page: number }) => Promise<PickerPage>;
  /** Meerdere foto's kiezen (vinkjes). */
  multiple?: boolean;
  /** Knop *Geen foto* tonen. */
  allowNone?: boolean;
}>();

const model = defineModel<number | number[] | null>({ default: null });

const name = useId();
const text = ref('');
const searchText = ref('');
const page = ref(1);
const photos = ref<PickerPhoto[]>([]);
const hasMore = ref(false);
const loading = ref(false);
const error = ref('');
let request = 0;

/**
 * Of een adres op de eigen site staat (geen ander domein, geen `data:` of `javascript:`).
 * @param url Het adres.
 * @returns Of het mag.
 */
function isLocalUrl(url: string): boolean {
  return /^\/(?![/\\])/.test(url);
}

/** Haalt de foto's van de huidige zoekterm en pagina op; een ouder antwoord dat later binnenkomt telt niet. */
async function fetchPhotos(): Promise<void> {
  const current = ++request;
  loading.value = true;
  error.value = '';
  try {
    const result = await props.load({ text: text.value, page: page.value });
    if (current !== request) return;
    photos.value = result.photos.filter((photo) => isLocalUrl(photo.url));
    hasMore.value = result.hasMore;
  } catch (failure) {
    if (current !== request) return;
    photos.value = [];
    hasMore.value = false;
    error.value = failure instanceof ApiError ? failure.message : 'De foto\'s konden niet worden geladen.';
  } finally {
    if (current === request) loading.value = false;
  }
}

/** Zoekt opnieuw vanaf de eerste pagina. */
function onSearch(): void {
  text.value = searchText.value.trim().slice(0, 100);
  page.value = 1;
  void fetchPhotos();
}

/**
 * Bladert naar een andere pagina.
 * @param value De pagina.
 */
function onPage(value: number): void {
  page.value = value;
  void fetchPhotos();
}

/**
 * Of een foto gekozen is.
 * @param id Id van de foto.
 * @returns Of hij gekozen is.
 */
function isChosen(id: number): boolean {
  return Array.isArray(model.value) ? model.value.includes(id) : model.value === id;
}

/**
 * Kiest een foto, of zet een vinkje aan of uit.
 * @param id Id van de foto.
 * @param checked Of het vinkje aan staat.
 */
function choose(id: number, checked: boolean): void {
  if (!props.multiple) {
    model.value = id;
    return;
  }
  const chosen = Array.isArray(model.value) ? model.value.filter((value) => value !== id) : [];
  model.value = checked ? [...chosen, id] : chosen;
}

/** Geen foto. */
function chooseNone(): void {
  model.value = props.multiple ? [] : null;
}

onMounted(fetchPhotos);
</script>

<template>
  <fieldset class="crm-photo-picker">
    <legend>{{ label }}</legend>
    <div
      class="crm-search"
      role="search"
    >
      <label :for="`${name}-zoek`">Zoek een foto</label>
      <input
        :id="`${name}-zoek`"
        v-model="searchText"
        type="search"
        maxlength="100"
        @keydown.enter.prevent="onSearch"
      >
      <button
        class="btn btn--small btn--outline"
        type="button"
        @click="onSearch"
      >
        Zoeken
      </button>
    </div>
    <StatusMessage
      kind="fout"
      :message="error"
    />
    <p
      class="visually-hidden"
      role="status"
    >
      {{ loading ? 'Foto\'s laden…' : '' }}
    </p>
    <ul
      v-if="photos.length"
      class="media-grid media-grid--pick"
      :aria-busy="loading ? 'true' : undefined"
    >
      <li
        v-for="photo in photos"
        :key="photo.id"
        class="media-grid__item"
      >
        <label class="media-pick">
          <input
            :type="multiple ? 'checkbox' : 'radio'"
            :name="name"
            :value="photo.id"
            :checked="isChosen(photo.id)"
            @change="choose(photo.id, ($event.target as HTMLInputElement).checked)"
          >
          <img
            :src="photo.url"
            :alt="photo.alt"
            loading="lazy"
            :width="photo.width || 400"
            :height="photo.height || 300"
          >
          <span class="media-grid__title">{{ photo.title }}</span>
          <span
            v-if="photo.meta"
            class="media-grid__meta"
          >{{ photo.meta }}</span>
        </label>
      </li>
    </ul>
    <p v-else-if="!loading && !error">
      Geen foto's gevonden. Upload foto's in de <a href="/app/fotobibliotheek/">fotobibliotheek</a> of zoek op iets anders.
    </p>
    <PagerNav
      :page="page"
      :has-next="hasMore"
      @update:page="onPage"
    />
    <div
      v-if="allowNone"
      class="crm-actions"
    >
      <button
        class="btn btn--small btn--outline"
        type="button"
        @click="chooseNone"
      >
        Geen foto
      </button>
    </div>
  </fieldset>
</template>

<style>
/* Buiten een formulier geen eigen rand en de kop zoals een veldlabel; in `.form` geldt de opmaak van een fieldset. */
:where(.crm-photo-picker) { min-width: 0; margin: 0; padding: 0; border: 0; }
:where(.crm-photo-picker) legend { margin: 0 0 .5rem; padding: 0; font-weight: 600; }
/* Keuzerondje en foto bovenaan de kaart, ook als de kaarten in een rij verschillend hoog zijn. */
.crm-photo-picker .media-pick { align-content: start; }
</style>

<!--
  Uploadveld: bestanden kiezen en uploaden, met label, hulp en fout zoals `form-field.vue` (gelijk aan het
  uploadformulier van de fotobibliotheek, `app/src/media/routes.js`). Vóór het uploaden controleert het veld soort,
  grootte en aantal, zodat een fout meteen te zien is; de server controleert de inhoud altijd zelf (magic bytes) en
  is de echte controle.

  Het component stuurt zelf niets: het scherm geeft `upload` mee (een functie die het `FormData` via `api.upload`
  naar een pad stuurt dat de server voor uploads toestaat, `multipartPaths` in `app/src/api/router.js`). Een
  `ApiError` van de server wordt de melding onder het veld.
-->
<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { ApiError } from '../api/client';

const props = defineProps<{
  label: string;
  help?: string;
  /** Naam van het veld in het `FormData` (standaard `bestand`). */
  name?: string;
  /** Toegestane soorten, zoals bij `<input accept>`: `image/jpeg,image/png`. Leeg: alles. */
  accept?: string;
  /** Meerdere bestanden tegelijk. */
  multiple?: boolean;
  /** Hoogstens zoveel bestanden tegelijk (standaard 20). */
  maxFiles?: number;
  /** Hoogstens zoveel bytes per bestand. */
  maxBytes?: number;
  /** Tekst op de knop (standaard `Uploaden`). */
  submitLabel?: string;
  /** Stuurt het `FormData` naar de server. */
  upload: (form: FormData) => Promise<unknown>;
}>();

const emit = defineEmits<{ uploaded: [result: unknown] }>();

const id = useId();
const helpId = `${id}-hulp`;
const errorId = `${id}-fout`;
const input = ref<HTMLInputElement | null>(null);
const files = ref<File[]>([]);
const error = ref('');
const busy = ref(false);
const describedBy = computed(() => [props.help ? helpId : '', error.value ? errorId : ''].filter(Boolean).join(' ') || undefined);
const allowedTypes = computed(() => (props.accept || '').split(',').map((type) => type.trim().toLowerCase()).filter(Boolean));

/**
 * Grootte leesbaar, zoals `2,5 MB`.
 * @param bytes Aantal bytes.
 * @returns Tekst.
 */
function readableSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} MB`;
}

/**
 * Of een bestand van een toegestane soort is (exact, of `image/*`).
 * @param file Het bestand.
 * @returns Of het mag.
 */
function typeAllowed(file: File): boolean {
  if (!allowedTypes.value.length) return true;
  const type = file.type.toLowerCase();
  return allowedTypes.value.some((allowed) => (allowed.endsWith('/*') ? type.startsWith(allowed.slice(0, -1)) : type === allowed));
}

/**
 * Controleert de gekozen bestanden.
 * @param chosen De bestanden.
 * @returns Een foutmelding, of ''.
 */
function checkFiles(chosen: File[]): string {
  const maxFiles = props.multiple ? props.maxFiles || 20 : 1;
  if (chosen.length > maxFiles) return `Kies hoogstens ${maxFiles} bestanden tegelijk.`;
  const wrongType = chosen.find((file) => !typeAllowed(file));
  if (wrongType) return `${wrongType.name} is geen toegestaan soort bestand.`;
  const tooLarge = props.maxBytes ? chosen.find((file) => file.size > (props.maxBytes || 0)) : undefined;
  if (tooLarge) return `${tooLarge.name} is te groot (${readableSize(tooLarge.size)}); hoogstens ${readableSize(props.maxBytes || 0)}.`;
  return '';
}

/** Neemt de gekozen bestanden over en controleert ze. */
function onChange(): void {
  files.value = Array.from(input.value?.files || []);
  error.value = checkFiles(files.value);
}

/** Uploadt de gekozen bestanden. */
async function submit(): Promise<void> {
  if (!files.value.length) {
    error.value = props.multiple ? 'Kies eerst een of meer bestanden.' : 'Kies eerst een bestand.';
    return;
  }
  error.value = checkFiles(files.value);
  if (error.value) return;
  const form = new FormData();
  files.value.forEach((file) => form.append(props.name || 'bestand', file));
  busy.value = true;
  try {
    const result = await props.upload(form);
    files.value = [];
    if (input.value) input.value.value = '';
    emit('uploaded', result);
  } catch (failure) {
    error.value = failure instanceof ApiError
      ? Object.values(failure.fields)[0] || failure.message
      : 'Het uploaden is mislukt. Probeer het opnieuw.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="field crm-upload">
    <span class="field__label">
      <label :for="id">{{ label }}</label>
    </span>
    <span
      v-if="help"
      :id="helpId"
      class="field__help"
    >{{ help }}</span>
    <div class="crm-upload__row">
      <input
        :id="id"
        ref="input"
        type="file"
        :name="name || 'bestand'"
        :accept="accept || undefined"
        :multiple="multiple"
        :disabled="busy"
        :aria-describedby="describedBy"
        :aria-invalid="error ? true : undefined"
        @change="onChange"
      >
      <button
        class="btn btn--small"
        type="button"
        :disabled="busy"
        @click="submit"
      >
        {{ busy ? 'Bezig met uploaden…' : submitLabel || 'Uploaden' }}
      </button>
    </div>
    <ul
      v-if="files.length && !error"
      class="crm-upload__files"
    >
      <li
        v-for="file in files"
        :key="file.name"
      >
        {{ file.name }} ({{ readableSize(file.size) }})
      </li>
    </ul>
    <span
      :id="errorId"
      class="field__error"
      role="alert"
    >{{ error }}</span>
  </div>
</template>

<style>
/* Bestand kiezen met de knop eronder, links uitgelijnd. */
.crm-upload__row { display: flex; flex-direction: column; align-items: flex-start; gap: .5rem; }
.crm-upload__row input[type="file"] { min-width: 0; max-width: 100%; }
.crm-upload__files { margin: .25rem 0 0; padding-left: 1.2rem; color: var(--av-muted); font-size: .9rem; overflow-wrap: anywhere; }
.crm-upload .field__error:empty { display: none; }
</style>

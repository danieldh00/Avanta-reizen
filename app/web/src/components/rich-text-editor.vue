<!--
  Teksteditor voor opgemaakte tekst, gelijk aan de huidige editor (`app/public/js/rich-editor.js`, klassen
  `rich-editor*` in `crm.css`): je ziet de tekst zoals op de site, Enter begint een nieuwe alinea, Shift+Enter een
  nieuwe regel, knoppen voor kopjes, vet, cursief, lijsten, citaat en links, en met *HTML* zie en wijzig je de code
  zelf. `v-model` is de opgeschoonde HTML.

  Er komt nooit ongeschoonde HTML in de pagina: opgeslagen en geplakte HTML gaat eerst door een inert document en de
  opschoner (`rich-text-tools.ts`), en het bewerkvak wordt alleen via DOM-knopen gevuld (geen `v-html`). De server
  schoont bij het opslaan altijd zelf op; dit is gemak, geen beveiliging. Een link vraagt het adres in een veld onder
  de knoppen in plaats van een venster van de browser.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue';
import {
  RICH_TEXT_TOOLS, UNSAFE_LINK_MESSAGE, currentBlock, editingSupported, htmlFromEditor, isSafeLink, linkHtml,
  nodesFromHtml, pastedHtml, type RichTextTool,
} from './rich-text-tools';

const props = defineProps<{
  label: string;
  help?: string;
  /** Foutmelding (van de server, `ApiError.fields`). */
  error?: string;
  required?: boolean;
  /** Hoogstens zoveel tekens HTML; een teller toont de lengte. De server weigert een te lange tekst altijd zelf. */
  maxlength?: number;
}>();

const model = defineModel<string>({ default: '' });

const id = useId();
const labelId = `${id}-label`;
const helpId = `${id}-hulp`;
const errorId = `${id}-fout`;
const linkId = `${id}-link`;
const describedBy = computed(() => [props.help ? helpId : '', props.error ? errorId : ''].filter(Boolean).join(' ') || undefined);

const supported = editingSupported();
const editor = ref<HTMLElement | null>(null);
const linkInput = ref<HTMLInputElement | null>(null);
const sourceMode = ref(!supported);
const pressed = ref<Record<number, boolean>>({});
const linkOpen = ref(false);
const linkAddress = ref('/');
const linkError = ref('');
let savedRange: Range | null = null;

const length = computed(() => model.value.length);
const tooLong = computed(() => Boolean(props.maxlength) && length.value > (props.maxlength || 0));

/** Vult het bewerkvak met de opgeschoonde HTML van het model. */
function fillEditor(): void {
  if (editor.value) editor.value.replaceChildren(...nodesFromHtml(model.value));
}

/** Zet de opgeschoonde HTML uit het bewerkvak in het model. */
function sync(): void {
  if (sourceMode.value || !editor.value) return;
  const html = htmlFromEditor(editor.value);
  if (html !== model.value) model.value = html;
}

/** Een leeg bewerkvak krijgt een lege alinea, zodat de eerste tekst meteen in een `<p>` komt. */
function ensureParagraph(): void {
  const box = editor.value;
  if (!box || box.querySelector('p, h2, h3, h4, h5, ul, ol, blockquote, table, figure, img')) return;
  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createElement('br'));
  box.replaceChildren(paragraph);
}

/** Zet de vaste instellingen van de browser: alinea's als `<p>`, opmaak als tags en niet als stijl. */
function prepareCommands(): void {
  document.execCommand('defaultParagraphSeparator', false, 'p');
  document.execCommand('styleWithCSS', false, 'false');
}

/** Werkt de aan/uit-stand van de knoppen bij naar de plek van de cursor. */
function updateStates(): void {
  if (!editor.value) return;
  const block = currentBlock(editor.value);
  const next: Record<number, boolean> = {};
  RICH_TEXT_TOOLS.forEach((tool, index) => {
    if (tool.state && tool.command) next[index] = document.queryCommandState(tool.command);
    else if (tool.block) next[index] = block === tool.block;
  });
  pressed.value = next;
}

/** Bewaart de selectie in het bewerkvak, zodat een link na het invullen van het adres op de juiste plek komt. */
function saveSelection(): void {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  savedRange = range && editor.value && editor.value.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

/** Zet de bewaarde selectie terug. */
function restoreSelection(): void {
  editor.value?.focus();
  const selection = window.getSelection();
  if (!selection || !savedRange) return;
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

/** Opent het veld voor het adres van een link. */
async function openLink(): Promise<void> {
  saveSelection();
  linkAddress.value = '/';
  linkError.value = '';
  linkOpen.value = true;
  await nextTick();
  linkInput.value?.focus();
  linkInput.value?.select();
}

/** Sluit het veld voor de link en gaat terug naar het bewerkvak. */
function closeLink(): void {
  linkOpen.value = false;
  linkError.value = '';
  restoreSelection();
}

/** Maakt van de selectie een link, of voegt het adres als link in als er niets geselecteerd is. */
function addLink(): void {
  const address = linkAddress.value.trim();
  if (!address) return closeLink();
  if (!isSafeLink(address)) {
    linkError.value = UNSAFE_LINK_MESSAGE;
    return;
  }
  const withSelection = Boolean(savedRange && !savedRange.collapsed);
  closeLink();
  if (withSelection) document.execCommand('createLink', false, address);
  else document.execCommand('insertHTML', false, linkHtml(address));
  sync();
}

/**
 * Voert een knop uit.
 * @param tool De knop.
 */
function run(tool: RichTextTool): void {
  if (tool.link) {
    void openLink();
    return;
  }
  const box = editor.value;
  if (!box || !tool.command) return;
  box.focus();
  prepareCommands();
  if (tool.block && tool.block !== 'p' && currentBlock(box) === tool.block) document.execCommand('formatBlock', false, '<p>');
  else document.execCommand(tool.command, false, tool.block ? `<${tool.block}>` : undefined);
  sync();
  updateStates();
}

/** Wisselt tussen het bewerkvak en de HTML-code. */
async function toggleSource(): Promise<void> {
  if (!sourceMode.value) sync();
  linkOpen.value = false;
  sourceMode.value = !sourceMode.value;
  await nextTick();
  if (!sourceMode.value) {
    fillEditor();
    sync();
    editor.value?.focus();
  }
}

/** Bij het invoegen van tekst: lege editor krijgt een alinea, en het model volgt. */
function onInput(): void {
  if (editor.value && !editor.value.textContent?.trim() && !editor.value.querySelector('img')) ensureParagraph();
  sync();
}

/**
 * Plakken: opmaak uit een tekstverwerker of website wordt eerst opgeschoond; platte tekst wordt alinea's.
 * @param event Het plakken.
 */
function onPaste(event: ClipboardEvent): void {
  const data = event.clipboardData;
  if (!data) return;
  event.preventDefault();
  const pasted = pastedHtml(data.getData('text/html'), data.getData('text/plain'));
  if (pasted) document.execCommand('insertHTML', false, pasted);
  sync();
}

/**
 * Bestanden slepen kan niet (foto's gaan via de fotobibliotheek).
 * @param event Het slepen.
 */
function onDrop(event: DragEvent): void {
  if (event.dataTransfer?.files.length) event.preventDefault();
}

/**
 * Ctrl+K (of Cmd+K) opent het veld voor een link.
 * @param event De toets.
 */
function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    void openLink();
  }
}

/**
 * Escape in het veld voor de link sluit het veld.
 * @param event De toets.
 */
function onLinkKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLink();
  }
}

/** Een klik op het label zet de cursor in het bewerkvak. */
function focusEditor(): void {
  if (sourceMode.value) document.getElementById(`${id}-html`)?.focus();
  else editor.value?.focus();
}

// Een waarde van buiten (bijvoorbeeld na Annuleren of opnieuw laden) die afwijkt van wat het bewerkvak toont, vult het
// bewerkvak opnieuw; een waarde die de editor zelf doorgaf, is gelijk en laat de cursor staan.
watch(model, (value) => {
  if (!sourceMode.value && editor.value && value !== htmlFromEditor(editor.value)) fillEditor();
});

onMounted(fillEditor);
</script>

<template>
  <div class="field">
    <span class="field__label">
      <span
        :id="labelId"
        @click="focusEditor"
      >{{ label }}</span>
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
    <div class="rich-editor">
      <div
        v-if="supported"
        class="rich-editor__toolbar"
        role="toolbar"
        aria-label="Opmaak"
      >
        <button
          v-for="(tool, index) in RICH_TEXT_TOOLS"
          :key="tool.label"
          class="btn btn--small btn--outline"
          type="button"
          :title="tool.title"
          :disabled="sourceMode"
          :aria-pressed="tool.state || tool.block ? (pressed[index] ? 'true' : 'false') : undefined"
          @mousedown.prevent
          @click="run(tool)"
        >
          {{ tool.label }}
        </button>
        <button
          class="btn btn--small btn--outline rich-editor__source"
          type="button"
          title="De HTML-code zien en wijzigen"
          :aria-pressed="sourceMode ? 'true' : 'false'"
          @click="toggleSource"
        >
          HTML
        </button>
      </div>
      <div
        v-if="linkOpen"
        class="rich-editor__link"
      >
        <label :for="linkId">Adres van de link</label>
        <input
          :id="linkId"
          ref="linkInput"
          v-model="linkAddress"
          type="text"
          maxlength="500"
          placeholder="/contact/, https://…, mailto:…"
          :aria-invalid="linkError ? true : undefined"
          :aria-describedby="linkError ? `${linkId}-fout` : undefined"
          @keydown.enter.prevent="addLink"
          @keydown="onLinkKeydown"
        >
        <button
          class="btn btn--small"
          type="button"
          @click="addLink"
        >
          Link toevoegen
        </button>
        <button
          class="btn btn--small btn--outline"
          type="button"
          @click="closeLink"
        >
          Annuleren
        </button>
        <span
          v-if="linkError"
          :id="`${linkId}-fout`"
          class="field__error"
          role="alert"
        >{{ linkError }}</span>
      </div>
      <div
        v-show="!sourceMode"
        ref="editor"
        class="rich-editor__content"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        :aria-labelledby="labelId"
        :aria-describedby="describedBy"
        :aria-invalid="error ? true : undefined"
        :aria-required="required ? true : undefined"
        @focus="prepareCommands(); ensureParagraph()"
        @input="onInput"
        @paste="onPaste"
        @drop="onDrop"
        @keydown="onKeydown"
        @keyup="updateStates"
        @mouseup="updateStates"
      />
      <textarea
        v-if="sourceMode"
        :id="`${id}-html`"
        v-model="model"
        :aria-labelledby="labelId"
        :aria-describedby="describedBy"
        :aria-invalid="error ? true : undefined"
        :required="required"
        rows="10"
      />
      <template v-if="maxlength">
        <span
          class="field__help rich-editor__count"
          :class="{ 'is-over': tooLong }"
        >{{ length }} van {{ maxlength }} tekens (met opmaak)</span>
        <span
          class="field__error rich-editor__warning"
          role="alert"
        >{{ tooLong ? 'De tekst is te lang; maak hem korter.' : '' }}</span>
      </template>
    </div>
    <span
      v-if="error"
      :id="errorId"
      class="field__error"
    >{{ error }}</span>
  </div>
</template>

<style>
/* Veld voor het adres van een link, onder de knoppen van de teksteditor. */
.rich-editor__link { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
.rich-editor__link input { flex: 1 1 14rem; min-width: 0; }
.rich-editor__link .field__error { flex-basis: 100%; }
</style>

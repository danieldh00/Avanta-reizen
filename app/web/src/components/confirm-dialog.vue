<!--
  Bevestigvenster voor een actie die niet ongedaan te maken is (verwijderen, versturen), met het `<dialog>`-element
  van de browser: modaal, Escape sluit, de focus blijft in het venster en gaat daarna terug naar de knop die het
  opende. Open met `open` (true/false); de keuze komt terug als `confirm` of `cancel`.
-->
<script setup lang="ts">
import { nextTick, onMounted, ref, watch, useId } from 'vue';

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  /** Tekst op de bevestigknop. */
  confirmLabel: string;
  /** Rode knop voor een actie die iets weghaalt. */
  danger?: boolean;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
const titleId = useId();
let opener: HTMLElement | null = null;

/**
 * Zet het venster open of dicht naar de waarde van `open`.
 * @param open Of het venster open moet.
 */
async function syncOpen(open: boolean): Promise<void> {
  const element = dialog.value;
  if (!element) return;
  if (open && !element.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    await nextTick();
    // Standaard de veilige keuze in focus.
    cancelButton.value?.focus();
  } else if (!open && element.open) {
    element.close();
    opener?.focus();
  }
}

watch(() => props.open, syncOpen, { flush: 'post' });
// Ook bij een venster dat meteen open moet (bijvoorbeeld met `v-if` en `open` tegelijk).
onMounted(() => syncOpen(props.open));

/** Het venster ging dicht zonder dat de ouder het vroeg (bijvoorbeeld via `form method="dialog"`): geldt als annuleren. */
function onClose(): void {
  if (props.open) {
    opener?.focus();
    emit('cancel');
  }
}

/** Escape of de knop Annuleren. */
function cancel(): void {
  emit('cancel');
}
</script>

<template>
  <dialog
    ref="dialog"
    class="crm-dialog"
    :aria-labelledby="titleId"
    @cancel.prevent="cancel"
    @close="onClose"
  >
    <h2 :id="titleId">
      {{ title }}
    </h2>
    <p>{{ message }}</p>
    <div class="crm-dialog-actions">
      <button
        ref="cancelButton"
        class="btn btn--outline"
        type="button"
        @click="cancel"
      >
        Annuleren
      </button>
      <button
        :class="['btn', { 'btn--danger': danger }]"
        type="button"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
    </div>
  </dialog>
</template>

<style>
/* Venster en knoppen; kleuren uit de huisstijl (`--av-*`, `--crm-*` in site.css en crm.css). */
.crm-dialog { width: min(32rem, calc(100vw - 2rem)); padding: 1.5rem; border: 1px solid var(--crm-line); border-radius: 8px; background: var(--av-white); color: var(--crm-ink); box-shadow: 0 12px 40px rgba(47, 46, 51, .25); }
.crm-dialog::backdrop { background: rgba(47, 46, 51, .45); }
.crm-dialog h2 { margin: 0 0 .75rem; font-size: 1.25rem; }
.crm-dialog p { margin: 0 0 1.25rem; }
.crm-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
.crm .btn--danger { background: #b3261e; border-color: #b3261e; color: #fff; }
.crm .btn--danger:hover, .crm .btn--danger:focus-visible { background: #8c1d18; border-color: #8c1d18; }
@media (max-width: 800px) {
  .crm-dialog-actions .btn { min-height: 44px; flex: 1 1 auto; }
}
</style>

<!--
  Bladeren door een lijst, gelijk aan `renderPager` uit `app/src/crm/ui.js`: Vorige, het paginanummer en Volgende.
  Niets als er maar één pagina is.
-->
<script setup lang="ts">
defineProps<{
  /** Huidige pagina, vanaf 1. */
  page: number;
  /** Of er een volgende pagina is. */
  hasNext: boolean;
}>();

const emit = defineEmits<{ 'update:page': [page: number] }>();
</script>

<template>
  <nav
    v-if="page > 1 || hasNext"
    class="crm-pager"
    aria-label="Bladeren"
  >
    <button
      v-if="page > 1"
      class="btn btn--small btn--outline"
      type="button"
      @click="emit('update:page', page - 1)"
    >
      Vorige
    </button>
    <span
      v-else
      class="crm-pager-off"
    >Vorige</span>
    <span class="crm-pager-page">Pagina {{ page }}</span>
    <button
      v-if="hasNext"
      class="btn btn--small btn--outline"
      type="button"
      @click="emit('update:page', page + 1)"
    >
      Volgende
    </button>
    <span
      v-else
      class="crm-pager-off"
    >Volgende</span>
  </nav>
</template>

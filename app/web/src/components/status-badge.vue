<!--
  Status als label met kleur, gelijk aan `renderStatus` uit `app/src/crm/ui.js` (klassen `crm-status--<soort>` in
  `crm.css`). Een onbekende soort krijgt `onbekend`, zodat er nooit een vrije tekst in een klassenaam komt.
-->
<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  /** Soort, bijvoorbeeld `betaald` of `concept`. */
  kind: string;
  /** Tekst op het label. */
  label: string;
}>();

const modifier = computed(() => (/^[a-z0-9-]{1,40}$/.test(props.kind) ? props.kind : 'onbekend'));
</script>

<template>
  <span :class="['crm-status', `crm-status--${modifier}`]">{{ label }}</span>
</template>

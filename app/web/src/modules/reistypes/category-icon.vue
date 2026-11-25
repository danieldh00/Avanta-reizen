<!--
  Icoon van een reistype als inline SVG, getekend uit de vormen die de server meegeeft (`ICONS` in
  `app/src/site/icons.js`): paden, cirkels en rechthoeken, zonder `v-html`. Versiering: de naam staat in de titel.
-->
<script setup lang="ts">
import type { IconShape } from './category-api';

defineProps<{
  /** Naam van het icoon (voor de klasse en de titel). */
  name: string;
  shapes: IconShape[];
}>();
</script>

<template>
  <span
    class="crm-icon"
    :title="name"
  >
    <svg
      :class="`icon icon--${name}`"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      <template
        v-for="(shape, index) in shapes"
        :key="index"
      >
        <circle
          v-if="shape.circle"
          :class="shape.fill ? 'icon__fill' : undefined"
          :cx="shape.circle[0]"
          :cy="shape.circle[1]"
          :r="shape.circle[2]"
        />
        <rect
          v-else-if="shape.rect"
          :class="shape.fill ? 'icon__fill' : undefined"
          :x="shape.rect[0]"
          :y="shape.rect[1]"
          :width="shape.rect[2]"
          :height="shape.rect[3]"
          :rx="shape.rect[4] || 0"
        />
        <path
          v-else
          :class="shape.fill ? 'icon__fill' : undefined"
          :d="shape.d"
        />
      </template>
    </svg>
  </span>
</template>

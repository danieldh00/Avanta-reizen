<!--
  Buitenste component van een module: alleen het scherm van de huidige route. De schil zelf (zijbalk, kopbalk,
  kruimelpad) blijft van de server tot fase V8.
-->
<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<template>
  <RouterView />
</template>

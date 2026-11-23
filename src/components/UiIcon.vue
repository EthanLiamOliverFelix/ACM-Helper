<script setup lang="ts">
const paths = {
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-left': 'm15 6-6 6 6 6',
  'chevron-up': 'm6 15 6-6 6 6',
  'arrow-right': 'M4 12h16m-6-6 6 6-6 6',
  'arrow-up': 'M12 20V4m-6 6 6-6 6 6',
  'arrow-down': 'M12 4v16m-6-6 6 6 6-6',
  external: 'M14 4h6v6m0-6L10 14M10 4H4v16h16v-6',
  refresh: 'M20 11a8 8 0 1 0-2 6M20 4v7h-7',
  play: 'm8 5 11 7-11 7Z',
  'step-over': 'M4 12a8 8 0 0 1 16 0m-4-4 4 4 3-4M12 18v2',
  'step-into': 'M12 3v12m-5-5 5 5 5-5M6 21h12',
  'step-out': 'M12 17V5m-5 5 5-5 5 5M6 21h12',
  resize: 'M6 6 14 14M12 20h8v-8',
} as const
defineProps<{ name: keyof typeof paths }>()
</script>

<template>
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="paths[name]" /></svg>
</template>

<style scoped>
.ui-icon { display: inline-block; width: 1em; height: 1em; flex: 0 0 auto; vertical-align: -.125em; }
</style>

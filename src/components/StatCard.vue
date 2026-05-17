<template>
  <div class="panel p-4">
    <div class="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">{{ label }}</div>
    <div class="text-2xl font-semibold mt-1" :class="toneClass">{{ value }}</div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  label: string
  value: number | string
  tone?: 'success' | 'danger' | 'info' | 'warning'
}>()
const toneClass = computed(() => ({
  success: 'text-[var(--color-success)]',
  danger: 'text-[var(--color-danger)]',
  info: 'text-[var(--color-accent)]',
  warning: 'text-[var(--color-warning)]',
}[props.tone || 'info'] || ''))
</script>

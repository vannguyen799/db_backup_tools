<template>
  <span class="badge" :class="cls">{{ status }}</span>
</template>

<script setup lang="ts">
const props = defineProps<{ status: string }>()
const cls = computed(() => ({
  success: 'badge-success',
  failed: 'badge-danger',
  running: 'badge-info',
  pending: 'badge-warning',
  cancelled: '',
}[props.status] || ''))
</script>

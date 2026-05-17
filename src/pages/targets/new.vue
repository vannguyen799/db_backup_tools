<template>
  <div>
    <NuxtLink to="/targets" class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">← Back to targets</NuxtLink>
    <h1 class="text-xl font-semibold mt-2 mb-6">New Backup Target</h1>

    <div class="panel p-6">
      <TargetForm :is-create="true" :busy="busy" @submit="onSubmit" />
      <div v-if="error" class="text-sm text-[var(--color-danger)] mt-3">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi'

const api = useApi()
const busy = ref(false)
const error = ref('')

async function onSubmit(form: Record<string, any>) {
  busy.value = true
  error.value = ''
  try {
    const created = await api.post<{ _id: string }>('/api/targets', form)
    await navigateTo(`/targets/${created._id}`)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}
</script>

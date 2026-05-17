<template>
  <div class="panel w-[380px] p-7">
    <div class="mb-5">
      <h1 class="text-lg font-semibold flex items-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)]"></span>
        Mongo Backup
      </h1>
      <p class="text-xs text-[var(--color-text-muted)] mt-1">Sign in to continue</p>
    </div>

    <form class="space-y-4" @submit.prevent="onSubmit">
      <div>
        <label class="label">Email</label>
        <input v-model="form.email" class="input" type="email" autocomplete="email" required />
      </div>
      <div>
        <label class="label">Password</label>
        <input v-model="form.password" class="input" type="password" autocomplete="current-password" required />
      </div>
      <div v-if="error" class="text-sm text-[var(--color-danger)]">{{ error }}</div>
      <button class="btn btn-primary w-full justify-center" :disabled="loading">
        {{ loading ? 'Signing in...' : 'Sign in' }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

definePageMeta({ layout: 'blank' })

const auth = useAuthStore()
const form = reactive({ email: '', password: '' })
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(form.email, form.password)
    await navigateTo('/')
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string }
    error.value = e.data?.message || e.message || 'Login failed'
  } finally {
    loading.value = false
  }
}
</script>

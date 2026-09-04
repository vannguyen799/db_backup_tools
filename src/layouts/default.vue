<template>
  <div class="flex min-h-screen">
    <aside class="w-60 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-6 flex flex-col">
      <div class="px-2 mb-6">
        <h1 class="text-base font-semibold flex items-center gap-2">
          <span class="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)]"></span>
          Mongo Backup
        </h1>
        <p class="text-xs text-[var(--color-text-muted)] mt-0.5">→ Google Drive</p>
      </div>

      <nav class="flex flex-col gap-1 text-sm flex-1">
        <NuxtLink to="/" class="nav-link" exact-active-class="active">Dashboard</NuxtLink>
        <NuxtLink to="/targets" class="nav-link" active-class="active">Backup Targets</NuxtLink>
        <NuxtLink to="/jobs" class="nav-link" active-class="active">Jobs</NuxtLink>
        <NuxtLink to="/api-keys" class="nav-link" active-class="active">API Keys</NuxtLink>
        <NuxtLink to="/mcp-connect" class="nav-link" active-class="active">MCP Connection</NuxtLink>
        <NuxtLink to="/settings" class="nav-link" active-class="active">Settings</NuxtLink>
      </nav>

      <div v-if="auth.user" class="mt-4 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-text-muted)]">
        <div class="px-2 mb-2">
          <div class="text-[var(--color-text)] text-sm">{{ auth.user.name }}</div>
          <div class="truncate">{{ auth.user.email }}</div>
        </div>
        <button class="nav-link w-full text-left" @click="auth.logout()">Sign out</button>
      </div>
    </aside>

    <main class="flex-1 px-8 py-6 max-w-[1400px]">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
const auth = useAuthStore()
onMounted(() => {
  if (!auth.ready) auth.hydrate()
  if (auth.isAuthenticated && !auth.user) auth.fetchMe()
})
</script>

<style scoped>
.nav-link {
  padding: .55rem .8rem;
  border-radius: 8px;
  color: var(--color-text-muted);
  transition: all .15s ease;
}
.nav-link:hover { background: var(--color-panel-2); color: var(--color-text); }
.nav-link.active { background: rgba(91,140,255,.12); color: var(--color-accent); }
</style>

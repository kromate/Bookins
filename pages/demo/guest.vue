<script setup lang="ts">
// Demo guest preview. Inside the owner shell, the guest page sits in a labelled frame (B10) so it never reads as a second
// copy of the app's own navigation. In Live it explains itself once and offers the way into Demo.
import { inject, ref } from 'vue'
import { useRouter } from 'vue-router'
import Book from '../Book.vue'
import AppIcon from '../../components/AppIcon.vue'
import { isDemo } from '../../runtime.ts'

type ChangeMode = (enabled: boolean) => Promise<void>
const changeMode = inject<ChangeMode | null>('changeMode', null)
const router = useRouter()
const switching = ref(false)

async function openInDemo() {
  if (!changeMode || switching.value) return
  switching.value = true
  try {
    await changeMode(true)
    if (isDemo.value) await router.push('/demo/guest')
  } finally {
    switching.value = false
  }
}
</script>

<template>
  <section v-if="!isDemo" class="demo-guest-blocked">
    <span class="empty-icon"><AppIcon name="external" /></span>
    <h1>Guest preview needs Demo</h1>
    <p>It shows a fictional business so you can try the booking page as a guest without touching your own data.</p>
    <div class="empty-actions">
      <button v-if="changeMode" class="primary" type="button" :disabled="switching" @click="openInDemo">{{ switching ? 'Switching…' : 'Switch to Demo' }}</button>
      <RouterLink class="secondary" to="/">Back to Today</RouterLink>
    </div>
  </section>
  <section v-else class="guest-frame" aria-labelledby="guest-frame-title">
    <header class="guest-frame__bar">
      <div>
        <!-- Not a heading: the guest page inside brings its own h1 (the host's name). -->
        <p id="guest-frame-title" class="guest-frame__title">Guest view</p>
        <p>What a guest sees on a booking link. Sample data; nothing here can be booked.</p>
      </div>
      <RouterLink class="secondary small" to="/">Back to Today</RouterLink>
    </header>
    <div class="guest-frame__page">
      <Book demo-preview />
    </div>
  </section>
</template>

<style scoped>
.demo-guest-blocked { max-width: 560px; margin: 48px auto; padding: 32px 28px; display: grid; justify-items: center; gap: var(--space-3); text-align: center; border: 1px solid var(--line); border-radius: var(--card-radius); background: var(--surface); }
.demo-guest-blocked h1 { margin: 0; font-size: var(--text-xl); }
.demo-guest-blocked p { max-width: 46ch; margin: 0; color: var(--muted); }
.guest-frame { display: grid; gap: var(--space-3); }
.guest-frame__bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); }
.guest-frame__title { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-strong); }
.guest-frame__bar p { margin: 2px 0 0; color: var(--muted); font-size: var(--text-sm); }
/* The guest page is built to fill a browser window; inside the frame it fills the frame instead. */
.guest-frame__page { overflow: hidden; border: 1px solid var(--line-strong); border-radius: var(--card-radius); box-shadow: var(--shadow-2); }
.guest-frame__page :deep(.bk) { min-height: 640px; }
</style>

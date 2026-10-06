<script setup>
import { inject, nextTick, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import GmWalkthrough from './ui/GmWalkthrough.vue'
import { createWalkthrough } from '../demo/useWalkthrough.js'
import { demoGuideRoutes, demoGuideSteps } from '../demo/guide.js'
import { isDemo } from '../runtime.js'

const route = useRoute()
const router = useRouter()
const loaded = inject('bookingLoaded')
const heading = ref(null)

const waitForGuestPreview = (signal) => new Promise((resolve, reject) => {
  const finish = () => {
    observer?.disconnect()
    signal.removeEventListener('abort', abort)
  }
  const abort = () => {
    finish()
    reject(new Error('Demo ended'))
  }
  const check = () => {
    if (signal.aborted || !isDemo.value) return abort()
    if (document.querySelector('[data-demo-guest-ready="true"]')) {
      finish()
      resolve()
    }
  }
  const observer = new MutationObserver(check)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true })
  signal.addEventListener('abort', abort, { once: true })
  check()
})

const guide = createWalkthrough({
  steps: demoGuideSteps,
  routes: demoGuideRoutes,
  navigate: async (step, { signal }) => {
    if (signal.aborted || !isDemo.value) throw new Error('Demo ended')
    if (router.currentRoute.value.path !== step.route) {
      const failure = await router.push(step.route)
      if (failure) throw new Error('Page navigation cancelled')
    }
    if (signal.aborted || !isDemo.value) throw new Error('Page navigation cancelled')
    await nextTick()
    if (step.route === '/demo/guest') await waitForGuestPreview(signal)
    if (
      signal.aborted ||
      !isDemo.value ||
      route.path !== step.route ||
      (step.route !== '/demo/guest' && loaded?.value !== true)
    )
      throw new Error('Sample page is not ready')
  },
})

onBeforeUnmount(guide.dispose)
defineExpose({ start: async () => { await guide.start(); await nextTick(); heading.value?.focus() } })
</script>

<template>
  <section v-show="guide.state.open" id="bookins-demo-guide" class="bookins-demo-guide" aria-label="Demo walkthrough">
    <div class="bookins-demo-guide-heading">
      <div>
        <p class="bookins-demo-guide-eyebrow">SAMPLE WALKTHROUGH</p>
        <h2 ref="heading" tabindex="-1">See how Bookins works</h2>
        <p>Review the owner workspace, then open a labelled guest preview. The walkthrough never creates a booking or changes data.</p>
      </div>
    </div>
    <GmWalkthrough :steps="guide.steps" :state="guide.state" @next="guide.next" @back="guide.back" @retry="guide.retry" @restart="guide.restart" @skip="guide.close" @finish="guide.close" />
  </section>
</template>

<style scoped>
.bookins-demo-guide { --gm-color-brand: #2336dc; --gm-color-brand-subtle: #eef0ff; --gm-color-focus: #2336dc; --gm-color-text: #172033; --gm-color-on-brand: #fff; display: grid; gap: 14px; margin: 24px; padding: 18px; border: 1px solid #dce1ff; border-radius: 14px; background: #f9faff; }
.bookins-demo-guide-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.bookins-demo-guide-heading > div { min-width: 0; }
.bookins-demo-guide-eyebrow { margin: 0 0 5px; color: #2336dc; font-size: 11px; font-weight: 800; letter-spacing: .08em; }
.bookins-demo-guide h2 { margin: 0; color: #172033; font-size: 20px; }
.bookins-demo-guide-heading p:last-child { max-width: 680px; margin: 6px 0 0; color: #5c667d; line-height: 1.5; }
@media (max-width: 700px) { .bookins-demo-guide { margin: 16px; padding: 16px 16px calc(16px + 88px + env(safe-area-inset-bottom)); scroll-margin-bottom: calc(88px + env(safe-area-inset-bottom)); } .bookins-demo-guide-heading { display: grid; } }
</style>

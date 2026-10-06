<script setup>
import { useRouter } from 'vue-router'
import Book from '../Book.vue'
import { isDemo } from '../../runtime.js'

const router = useRouter()
const returnToBookins = () => router.push('/')
</script>

<template>
  <section v-if="!isDemo" class="demo-guest-blocked" role="alert">
    <p class="eyebrow">Guest preview</p>
    <h1>Guest preview is available in Demo only.</h1>
    <p>Return to Bookins, enter Demo, then open Guest preview from the sample workspace.</p>
    <button class="primary" type="button" @click="returnToBookins">Return to Bookins</button>
  </section>
  <Book v-else demo-preview />
</template>

<style scoped>
.demo-guest-blocked { max-width: 560px; margin: 48px auto; padding: 28px; text-align: center; }
.demo-guest-blocked h1 { margin: 8px 0 12px; }
.demo-guest-blocked p:not(.eyebrow) { margin-bottom: 20px; color: var(--muted); }
</style>

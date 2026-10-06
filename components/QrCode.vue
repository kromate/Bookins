<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  value: { type: String, default: '' },
  size: { type: Number, default: 200 },
  label: { type: String, default: 'QR code' },
  filename: { type: String, default: 'bookins-qr.png' },
})

const src = ref('')
const failed = ref(false)
let token = 0

async function render() {
  const current = ++token
  const value = String(props.value || '').trim()
  failed.value = false
  if (!value) {
    src.value = ''
    return
  }
  try {
    const { default: QRCode } = await import('qrcode')
    const url = await QRCode.toDataURL(value, {
      margin: 1,
      errorCorrectionLevel: 'M',
      width: Math.max(64, Math.round(props.size * 2)),
    })
    if (current === token) src.value = url
  } catch {
    if (current === token) {
      src.value = ''
      failed.value = true
    }
  }
}

watch(() => [props.value, props.size], render, { immediate: true })

function download() {
  if (!src.value) return
  const link = document.createElement('a')
  link.href = src.value
  link.download = props.filename || 'bookins-qr.png'
  document.body.append(link)
  link.click()
  link.remove()
}
</script>

<template>
  <div class="qr-code">
    <img
      v-if="src"
      class="qr-image"
      :src="src"
      :alt="label"
      :width="size"
      :height="size"
    />
    <div v-else class="qr-placeholder" :style="{ width: size + 'px', height: size + 'px' }" role="status">
      {{ failed ? 'The QR code could not be created.' : value ? 'Creating QR code…' : 'No link to encode yet.' }}
    </div>
    <button class="secondary qr-download" type="button" :disabled="!src" @click="download">Download PNG</button>
  </div>
</template>

<style scoped>
.qr-code { display: inline-flex; flex-direction: column; align-items: center; gap: var(--space-3); max-width: 100%; }
.qr-image { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; image-rendering: pixelated; }
.qr-placeholder { max-width: 100%; display: grid; place-items: center; padding: 12px; box-sizing: border-box; color: var(--muted); border: 1px dashed var(--line-strong, var(--line)); border-radius: var(--radius-sm); font-size: var(--text-sm); text-align: center; }
.qr-download { width: 100%; justify-content: center; }
</style>

<script setup>
defineProps({
  compact: { type: Boolean, default: false },
  inverse: { type: Boolean, default: false },
})
</script>

<template>
  <span class="bookins-logo" :class="{ compact, inverse }" aria-label="Bookins">
    <svg viewBox="0 0 22 36" aria-hidden="true">
      <path d="M1 5.155c2.753 1.93 4.706 4.8 5.495 8.068-.091-2.23.061-4.465.453-6.663.303-1.697.791-3.446 1.973-4.699C10.104.609 12.16.034 13.595.989c1.477.981 1.707 3.173.992 4.792-.715 1.62-2.13 2.811-3.499 3.941 1.179-.422 2.369-.847 3.613-.97 1.244-.124 2.567.084 3.572.829 1.491 1.106 1.982 3.233 1.496 5.025-.487 1.791-1.792 3.264-3.292 4.362a15.132 15.132 0 0 1-6.372 2.489c-1.192.137-2.663-.044-3.156-.137-.283-.626-.039-1.752.287-2.357.408-.756 1.073-1.321 1.632-1.722 1.208-.872 2.465-.977 3.92-.659 1.58.345 3.767 1.683 3.968 3.288.2 1.604-1.542 4.986-2.448 6.618" fill="none" stroke="currentColor" stroke-width="2.526" stroke-linejoin="round"/>
    </svg>
    <span v-if="!compact" class="bookins-wordmark">ookins</span>
  </span>
</template>

<style scoped>
.bookins-logo{display:inline-flex;align-items:center;min-height:40px;color:#2336dc;font-size:26px;font-weight:850;letter-spacing:-.055em;line-height:1}.bookins-logo svg{width:22px;height:36px;flex:none}.bookins-wordmark{margin-left:-1px;color:#101928}.bookins-logo.inverse{color:#fff}.bookins-logo.inverse .bookins-wordmark{color:#fff}.bookins-logo.compact{width:38px;height:38px;min-height:38px;justify-content:center;border-radius:12px;background:#eef1ff}.bookins-logo.compact svg{width:19px;height:31px}
</style>

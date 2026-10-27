<script setup lang="ts">
// Bookins identity: "booked slot". The mark is a lowercase b made of a time rail (stem) holding a slot (bowl) with one
// entry written in. The wordmark is drawn on the same geometry (slot-shaped bowls), so it renders identically on every
// device without a web font. Geometry and rules: docs/BRAND.md. Static exports: public/bookins/.
withDefaults(defineProps<{
  /** Mark only (no wordmark). */
  compact?: boolean
  /** For dark or indigo backgrounds. */
  inverse?: boolean
  /** One colour, follows currentColor (the entry line is cut out). */
  mono?: boolean
  /** Hidden from assistive tech, for when the word "Bookins" is already written next to it. */
  decorative?: boolean
}>(), { compact: false, inverse: false, mono: false, decorative: false })
</script>

<template>
  <svg
    class="bookins-logo"
    :class="{ 'is-compact': compact, 'is-inverse': inverse, 'is-mono': mono }"
    :viewBox="compact ? '0 0 32 32' : '0 0 156 32'"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : 'Bookins'"
    :aria-hidden="decorative ? 'true' : undefined"
    focusable="false"
  >
    <template v-if="mono">
      <path
        class="bookins-logo__mono"
        fill-rule="evenodd"
        d="M5 4.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V13H22a7 7 0 0 1 7 7v2a7 7 0 0 1-7 7H5zM16.75 19.75h7.5a1.25 1.25 0 0 1 0 2.5h-7.5a1.25 1.25 0 0 1 0-2.5z"
      />
    </template>
    <template v-else>
      <path class="bookins-logo__slot" d="M11 13H22a7 7 0 0 1 7 7v2a7 7 0 0 1-7 7H11z" />
      <path class="bookins-logo__stem" d="M5 4.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V29H5z" />
      <rect class="bookins-logo__entry" x="15.5" y="19.75" width="9" height="2.5" rx="1.25" />
    </template>
    <g v-if="!compact" class="bookins-logo__word" transform="translate(38 0.6) scale(1.18)">
      <path
        fill="none"
        stroke-width="3.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M1.7 3.7V22.3M1.7 11.7H7.7A4.6 4.6 0 0 1 12.3 16.3V17.7A4.6 4.6 0 0 1 7.7 22.3H1.7M22.9 11.7H24.3A4.6 4.6 0 0 1 28.9 16.3V17.7A4.6 4.6 0 0 1 24.3 22.3H22.9A4.6 4.6 0 0 1 18.3 17.7V16.3A4.6 4.6 0 0 1 22.9 11.7ZM39.6 11.7H41A4.6 4.6 0 0 1 45.6 16.3V17.7A4.6 4.6 0 0 1 41 22.3H39.6A4.6 4.6 0 0 1 35 17.7V16.3A4.6 4.6 0 0 1 39.6 11.7ZM51.3 3.7V22.3M60.2 11.7L51.3 18.6M55.3 15.5L60.8 22.3M66.3 11.7V22.3M72.3 22.3V11.7M72.3 16.3A4.6 4.6 0 0 1 76.9 11.7H78.3A4.6 4.6 0 0 1 82.9 16.3V22.3M96.6 13.4C95.6 12.2 94.2 11.7 92.6 11.7C90.5 11.7 89 12.9 89 14.6C89 16.5 90.6 16.9 92.9 17.2C95.2 17.5 97.2 18 97.2 19.9C97.2 21.4 95.5 22.3 93.2 22.3C91.4 22.3 89.8 21.7 88.7 20.6"
      />
      <circle cx="66.3" cy="5.4" r="2.1" />
    </g>
  </svg>
</template>

<style scoped>
.bookins-logo {
  --logo-stem: var(--indigo-700, #2e3fa8);
  --logo-slot: var(--marigold-400, #f2b33d);
  --logo-entry: var(--n-900, #1a1f3d);
  --logo-word: var(--n-900, #1a1f3d);
  display: block;
  flex: none;
  width: auto;
  height: 28px;
  overflow: visible;
}
.bookins-logo.is-compact { height: 32px; }
.bookins-logo__stem { fill: var(--logo-stem); }
.bookins-logo__slot { fill: var(--logo-slot); }
.bookins-logo__entry { fill: var(--logo-entry); }
.bookins-logo__word { stroke: var(--logo-word); fill: var(--logo-word); }
.bookins-logo__word path { fill: none; }
.bookins-logo.is-inverse { --logo-stem: #ffffff; --logo-word: #ffffff; }
.bookins-logo.is-mono { --logo-word: currentColor; }
.bookins-logo__mono { fill: currentColor; }
</style>

<template>
  <section>
    <div v-if="localPreview" class="notice">Local preview data is stored only in this browser and is never shown on a hosted App.</div>
    <div class="page-header"><div><p class="eyebrow">Workspace overview</p><h1>Make every booking easy to keep.</h1><p class="lede">Set one reliable schedule, publish focused services, then manage confirmed appointments from here.</p></div><RouterLink class="primary action" to="/services">Add a service</RouterLink></div>
    <div class="grid grid-3 metrics"><article class="card"><span class="label">Active services</span><div class="metric">{{ activeServices }}</div><p class="muted">Visible through your public booking link.</p></article><article class="card"><span class="label">Upcoming bookings</span><div class="metric">{{ upcoming }}</div><p class="muted">Confirmed appointments that have not started.</p></article><article class="card"><span class="label">Open weekdays</span><div class="metric">{{ openDays }}</div><p class="muted">Using {{ state.schedules[0]?.timezone || 'no timezone yet' }}.</p></article></div>
    <div class="grid grid-2 lower">
      <article class="card"><p class="eyebrow">Setup</p><h2>{{ ready ? 'Ready to receive bookings' : 'Finish the core setup' }}</h2><ul><li :class="{ done: state.profile }">Business profile and timezone</li><li :class="{ done: state.schedules.length }">Weekly availability</li><li :class="{ done: activeServices }">At least one active service</li><li :class="{ done: publicUrl }">Public booking link</li></ul><RouterLink class="secondary action" :to="nextSetup.to">{{ nextSetup.label }}</RouterLink></article>
      <article class="card"><p class="eyebrow">Public page</p><h2>{{ publicUrl ? 'Your booking link is live' : 'Create a release-pinned link' }}</h2><p class="muted">The link can create bookings only through this App installation. It cannot access your full Goalmatic workspace.</p><div v-if="publicUrl" class="link-row"><code>{{ publicUrl }}</code><button class="secondary" type="button" @click="copy">Copy</button></div><RouterLink v-else class="primary action" to="/settings">Open settings</RouterLink><p v-if="copied" class="success" role="status">Copied.</p></article>
    </div>
  </section>
</template>
<script setup>
import { computed, inject, ref } from 'vue'
const state=inject('bookingState'),localPreview=inject('localPreview'),copied=ref(false),now=Date.now()
const activeServices=computed(()=>state.services.filter(item=>item.active!==false&&item.visibility==='public').length)
const upcoming=computed(()=>state.bookings.filter(item=>item.status!=='cancelled'&&Date.parse(item['starts_at'])>now).length)
const openDays=computed(()=>{try{return new Set(JSON.parse(state.schedules[0]?.['weekly_windows_json']||'[]').map(item=>item.weekday)).size}catch{return 0}})
const publicUrl=computed(()=>state.profile?.['public_link_url']||'')
const ready=computed(()=>!!state.profile&&!!state.schedules.length&&!!activeServices.value&&!!publicUrl.value)
const nextSetup=computed(()=>!state.profile?{to:'/settings',label:'Create profile'}:!state.schedules.length?{to:'/availability',label:'Set availability'}:!activeServices.value?{to:'/services',label:'Create service'}:{to:'/settings',label:'Manage public link'})
async function copy(){await navigator.clipboard.writeText(publicUrl.value);copied.value=true;setTimeout(()=>copied.value=false,1600)}
</script>
<style scoped>.action{display:inline-flex;align-items:center;text-decoration:none}.metrics{margin-bottom:18px}.metrics p{margin:8px 0 0}.lower{margin-top:18px}.card ul{display:grid;gap:11px;padding:0;list-style:none;margin:22px 0}.card li:before{content:'○';margin-right:9px;color:#979daf}.card li.done:before{content:'●';color:var(--success)}.link-row{display:flex;gap:8px;align-items:center}.link-row code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:12px;border-radius:9px;background:#f1f2f7}.success{margin-top:10px;color:var(--success)}
</style>

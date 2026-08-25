<template>
  <section>
    <div class="page-header">
      <div><p class="eyebrow">Workspace overview</p><h1>Make the next appointment easy to book.</h1><p class="lede">Configure the services and hours your guests can see, then keep every request in one calm workspace.</p></div>
      <RouterLink class="button button-primary action-link" to="/services">Add a service</RouterLink>
    </div>
    <div class="overview-grid">
      <article class="card workspace-object"><div class="object-top"><span class="card-label">Booking surface</span><span class="state-chip">{{ activeSlots }} active days</span></div><h2>{{ workspace.businessName || 'Your booking workspace' }}</h2><p class="muted">{{ workspace.services.length ? 'Guests can discover your configured services.' : 'Start with one service and a clear weekly schedule.' }}</p><div class="object-line"><span>Public booking slug</span><strong>{{ workspace.businessName ? slug : 'Not configured' }}</strong></div><RouterLink class="text-link" to="/availability">Review availability →</RouterLink></article>
      <article class="card"><p class="card-label">Schedule preview</p><h2>{{ nextDay }}</h2><div v-if="nextHours" class="schedule-row"><span class="status-dot live"></span><strong>{{ nextHours.start }}–{{ nextHours.end }}</strong><span class="muted">{{ workspace.timezone }}</span></div><div v-else class="empty compact"><p>No active hours yet.</p><RouterLink class="text-link" to="/availability">Set weekly hours</RouterLink></div></article>
      <article class="card"><p class="card-label">Operational status</p><div class="status-heading"><span class="status-dot" :class="operational ? 'live' : ''"></span><h2>{{ operational ? 'Ready for setup' : 'Needs setup' }}</h2></div><p class="muted">{{ operational ? 'Your workspace has a service and at least one open day.' : 'Add a service and open at least one day to prepare the booking flow.' }}</p></article>
    </div>
    <section class="section-block"><div class="section-heading"><div><p class="eyebrow">Fast path</p><h2>Set up in the order guests experience it</h2></div></div><div class="steps grid grid-3"><article v-for="(step,i) in steps" :key="step.title" class="step"><span class="step-number">0{{ i+1 }}</span><h3>{{ step.title }}</h3><p>{{ step.text }}</p><RouterLink class="text-link" :to="step.to">{{ step.action }} →</RouterLink></article></div></section>
  </section>
</template>
<script setup>
import { computed, inject } from 'vue'
const workspace = inject('workspace')
const activeSlots = computed(() => workspace.availability.filter(day => day.active).length)
const nextHours = computed(() => workspace.availability.find(day => day.active))
const nextDay = computed(() => nextHours.value?.day || 'Your next open day')
const operational = computed(() => workspace.services.length > 0 && activeSlots.value > 0)
const slug = computed(() => workspace.businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'workspace')
const steps = [{ title:'Define a service', text:'Give guests one clear reason to choose a time.', action:'Manage services', to:'/services' },{ title:'Open your week', text:'Choose the days and intervals you want to receive requests.', action:'Edit availability', to:'/availability' },{ title:'Review requests', text:'Confirm, reschedule, or cancel appointments from one ledger.', action:'Open bookings', to:'/bookings' }]
</script>
<style scoped>.overview-grid{display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:18px}.object-top,.object-line,.status-heading,.schedule-row{display:flex;align-items:center;gap:10px}.object-top{justify-content:space-between}.workspace-object h2{font-size:30px;margin:32px 0 10px}.object-line{justify-content:space-between;margin:28px 0 20px;padding-top:16px;border-top:1px solid var(--border);font-size:13px}.state-chip{color:#176b45;background:#e7f5ed;border-radius:5px;padding:7px 9px;font-size:12px;font-weight:700}.live{background:#1c8b5a}.status-heading h2{margin:20px 0 8px}.section-block{margin-top:48px}.steps{margin-top:16px}.step{padding:4px 0 12px;border-top:2px solid var(--accent)}.step-number{display:block;margin:16px 0 24px;color:var(--accent);font-family:ui-monospace,monospace;font-weight:800}.step p{color:var(--muted);line-height:1.55}.text-link{display:inline-flex;align-items:center;min-height:44px;color:#174ea6;font-weight:750;text-decoration:none}.compact{padding:18px 10px}.compact p{margin-bottom:5px}@media(max-width:1000px){.overview-grid{grid-template-columns:1fr 1fr}.workspace-object{grid-column:1/-1}}@media(max-width:600px){.overview-grid{grid-template-columns:1fr}.workspace-object{grid-column:auto}.workspace-object h2{font-size:26px}}</style>
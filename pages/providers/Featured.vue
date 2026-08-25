<template>
  <section>
    <p class="eyebrow">Provider</p>
    <h1>Featured provider</h1>
    <div class="card detail-card">
      <div class="avatar" aria-label="Provider initials">—</div>
      <div>
        <h2>Provider details are not configured</h2>
        <p class="muted">Credentials, services, policies, and availability will be shown when supplied by the connected workspace.</p>
      </div>
    </div>
    <div class="empty">
      <h2>Request unavailable</h2>
      <p>No provider data is available to select yet.</p>
      <RouterLink class="button button-primary action-link" to="/search">Return to search</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.detail-card { display:flex; gap:18px; align-items:center; max-width:760px; margin:25px 0; }
.avatar { width:70px; height:88px; display:grid; place-items:center; background:#edf0f4; color:var(--muted); border-radius:8px; font-size:24px; }
.action-link { display:inline-flex; align-items:center; text-decoration:none; }
@media (max-width:500px) { .detail-card { align-items:flex-start; flex-direction:column; } }
</style>
<template>
  <main>
    <h1>Dashboard</h1>
    <router-link to="/dashboard/settings">Settings</router-link>
    <button @click="refresh">Refresh</button>
  </main>
</template>

<script setup>
async function refresh() {
  await fetch("/api/stats");
}
</script>

<template>
  <main>
    <h1>Home</h1>
    <NuxtLink to="/about">About</NuxtLink>
    <button @click="goBlog">Blog</button>
  </main>
</template>

<script setup>
function goBlog() {
  navigateTo("/blog");
}
</script>

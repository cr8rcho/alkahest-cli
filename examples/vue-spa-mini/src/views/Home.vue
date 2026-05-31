<template>
  <main>
    <h1>Home</h1>
    <router-link to="/about">About</router-link>
    <button @click="go">Dashboard</button>
  </main>
</template>

<script setup>
import { useRouter } from "vue-router";
const router = useRouter();
function go() {
  router.push("/dashboard");
}
</script>

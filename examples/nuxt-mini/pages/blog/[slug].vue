<template>
  <main>
    <h1>Post</h1>
    <NuxtLink to="/blog">Back to blog</NuxtLink>
  </main>
</template>

<script setup>
const route = useRoute();
const { data: post } = await useAsyncData(() => $fetch(`/api/posts/${route.params.slug}`));
</script>

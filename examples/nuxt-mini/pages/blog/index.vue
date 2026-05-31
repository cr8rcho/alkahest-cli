<template>
  <main>
    <h1>Blog</h1>
    <ul>
      <li v-for="post in posts" :key="post.slug">
        <NuxtLink :to="`/blog/${post.slug}`">{{ post.title }}</NuxtLink>
      </li>
    </ul>
  </main>
</template>

<script setup>
const { data: posts } = await useFetch("/api/posts");
</script>

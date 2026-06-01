<script>
  import { goto } from "$app/navigation";
</script>

<main>
  <h1>Home</h1>
  <a href="/about">About</a>
  <button on:click={() => goto("/blog")}>Blog</button>
</main>

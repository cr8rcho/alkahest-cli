<script>
  let posts = [];
  async function load() {
    const res = await fetch("/api/posts");
    posts = await res.json();
  }
</script>

<main>
  <h1>Blog</h1>
  <ul>
    {#each posts as post}
      <li><a href="/blog/{post.slug}">{post.title}</a></li>
    {/each}
  </ul>
</main>

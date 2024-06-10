import { $ } from "bun";

await $`mkdir -p demo/dist`;
await $`bun build --minify --sourcemap src/index.ts > demo/dist/index.js`;
await $`cp demo/src/*.html demo/dist/`;
if (!Bun.file("demo/dist/spring-blender-open-movie.mkv").exists()) {
	await $`curl -Lo demo/dist/spring-blender-open-movie.mkv https://public-files.yifangu.com/videos/spring-blender-open-movie.mkv`;
}


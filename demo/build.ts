import { $ } from "bun";

await $`mkdir -p demo/dist`;
await $`bun build --minify src/index.ts > demo/dist/index.js`;
await $`cp demo/src/*.html demo/dist/`;
await $`[ -e demo/dist/spring-blender-open-movie.mkv ] || curl -Lo demo/dist/spring-blender-open-movie.mkv https://public-files.yifangu.com/videos/spring-blender-open-movie.mkv`;

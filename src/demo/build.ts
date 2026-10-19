import { $ } from "bun";

const demos = ["shaka"] as const;
const sample = "dist/demo/spring-blender-open-movie.mkv";

await $`mkdir -p dist/demo`;
for (const demo of demos) {
	await $`rm -rf dist/demo/${demo}`;
	await $`mkdir -p dist/demo/${demo}`;
	await $`bun build src/demo/${demo}/index.ts --outdir dist/demo/${demo} --minify`;
	const html = await Bun.file(`src/demo/${demo}/index.html`).text();
	await Bun.write(
		`dist/demo/${demo}/index.html`,
		html.replaceAll('src="index.ts"', 'src="index.js"'),
	);
}

if (!(await Bun.file(sample).exists())) {
	await $`curl -fLo ${sample} https://public-files.yifangu.com/videos/spring-blender-open-movie.mkv`;
}

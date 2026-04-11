import { CacheBlobLike } from "../src/bloblike/cache.js";
import { MKVToMP4Muxer } from "../src/player/index.js";

const filename = process.argv[2];
const outputFilename = process.argv[3];

// const file = new Blob([await Bun.file(filename).arrayBuffer()]);
// const file = new Blob([Bun.mmap(filename)]);
const file = new CacheBlobLike(Bun.file(filename));
const outputFile = Bun.file(outputFilename);

const writer = outputFile.writer();

const muxer = new MKVToMP4Muxer(file);
const initSegment = await muxer.getInitSegment();
writer.write(initSegment);
console.log("Writing init segment", initSegment.byteLength);
await writer.flush();
console.log("Flushed init segment");

for await (const chunk of muxer.streamFrom(0)) {
	console.log("Writing chunk", chunk.byteLength);
	writer.write(chunk);
	// await writer.flush();
}

await writer.end();

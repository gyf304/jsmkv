import { MKVToMP4Muxer } from "../src/player/index.js";

const filename = process.argv[2];
const outputFilename = process.argv[3];

// const file = new Blob([await Bun.file(filename).arrayBuffer()]);
// const file = new Blob([Bun.mmap(filename)]);
const rawFile = Bun.file(filename);
console.log("File size:", rawFile.size);

const memParts: ArrayBuffer[] = [];
const sizeLimit = 1 << 30;
let offset = 0;
while (offset < rawFile.size) {
	const size = Math.min(sizeLimit, rawFile.size - offset);
	const part = await rawFile.slice(offset, offset + size).arrayBuffer()
	memParts.push(part);
	offset += size;
}
const memFile = new Blob(memParts);


const outputFile = Bun.file(outputFilename);

const writer = outputFile.writer();

const muxer = new MKVToMP4Muxer(new Blob([memFile]));
const initializationSegment = await muxer.getInitiationSegment();
writer.write(initializationSegment);
await writer.flush();

for await (const chunk of muxer.streamFrom(0)) {
	writer.write(chunk);
	await writer.flush();
}

await writer.end();

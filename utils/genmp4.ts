import { MKVToMP4Muxer } from "../src/player/index.js";

const filename = process.argv[2];
const outputFilename = process.argv[3];

const file = new Blob([await Bun.file(filename).arrayBuffer()]);
const outputFile = Bun.file(outputFilename);

const writer = outputFile.writer();

const muxer = new MKVToMP4Muxer(file);
const initializationSegment = await muxer.getInitiationSegment();
writer.write(initializationSegment);
await writer.flush();

for await (const chunk of muxer.streamFrom(0)) {
	writer.write(chunk);
	await writer.flush();
}

await writer.end();

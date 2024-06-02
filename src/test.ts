import { File } from "./matroska";
import * as mkve from "./matroska/elements";
import * as ebml from "./ebml";
import { BlobLike, FetchBlobLike } from "./bloblike";
import { MKVVideoPlayer } from "./player";

const mkvFilePath = Bun.argv[2];
let mkvFile: BlobLike;
if (mkvFilePath.startsWith("http://") || mkvFilePath.startsWith("https://")) {
	mkvFile = await FetchBlobLike.fromUrl(mkvFilePath);
} else {
	mkvFile = new Blob([await Bun.file(mkvFilePath).arrayBuffer()]);
}

const stream = new ebml.Stream(mkvFile);
const mkv = new File(stream);
const segment = await mkv.one(mkve.Segment, { before: mkve.Cluster });

const writer = Bun.stdout.writer();
for await (const cluster of segment.clusters) {
	for await (const block of cluster.simpleBlocks) {
		const trackNumber = await block.trackNumber;
		if (trackNumber === 1) {
			const data = await block.data;
			await writer.write(data);
		}
	}
}
await writer.flush();

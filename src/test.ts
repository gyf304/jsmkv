import { File } from "./matroska";
import * as mkve from "./matroska/elements";
import * as ebml from "./ebml";
import { BlobLike, FetchBlobLike } from "./bloblike";

const mkvFilePath = Bun.argv[2];
let mkvFile: BlobLike;
if (mkvFilePath.startsWith("http://") || mkvFilePath.startsWith("https://")) {
	mkvFile = await FetchBlobLike.fromUrl(mkvFilePath);
} else {
	mkvFile = new Blob([await Bun.file(mkvFilePath).arrayBuffer()]);
}

const stream = new ebml.Stream(mkvFile);
const mkv = new File(stream);

const block = await mkv.one(mkve.Segment).then(s => s.one(mkve.Cluster)).then(c => c.one(mkve.SimpleBlock));
const writer = Bun.stdout.writer();
for await (const data of block.frameData) {
	writer.write(data);
}
await writer.flush();

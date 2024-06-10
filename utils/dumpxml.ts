import { CacheBlobLike } from "../src/bloblike/cache.js";
import * as ebml from "../src/ebml/index.js";
import * as matroska from "../src/matroska/index.js";

const filename = process.argv[2];

const ebmlStream = new ebml.Stream(new CacheBlobLike(Bun.file(filename)));
const mkv = new matroska.File(ebmlStream);
console.log(await mkv.toXML());

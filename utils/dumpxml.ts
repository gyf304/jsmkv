import * as ebml from "../src/ebml/index.js";
import * as matroska from "../src/matroska/index.js";

const filename = process.argv[2];

const ebmlStream = new ebml.Stream(new Blob([await Bun.file(filename).arrayBuffer()]));
const mkv = new matroska.File(ebmlStream);
console.log(await mkv.toXML());

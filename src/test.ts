import { BYOBlob } from "./byoblob";
import { MKV } from "./mkv";
import * as mkve from "./mkv/elements";
import * as ebml from "./ebml";

// const blob = new Blob(["hello world"]);
// console.log(await (new Blob(["hello world"])).slice(1).slice(1).text());

const mkvFilePath = Bun.argv[2];
const mkvFile = Bun.file(mkvFilePath);

const stream = new ebml.Stream(mkvFile);
const mkv = new MKV(stream);

console.log(await mkv.one(mkve.Segment).then(s => s.one(mkve.Info)).then(i => i.toXML()));

// throw new Error("TODO: fix this");

// console.log(await mkv.toXML());

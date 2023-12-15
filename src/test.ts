import { File } from "./matroska";
import * as mkve from "./matroska/elements";
import * as ebml from "./ebml";

const mkvFilePath = Bun.argv[2];
const mkvFile = Bun.file(mkvFilePath);

const stream = new ebml.Stream(mkvFile);
const mkv = new File(stream);

console.log(await mkv.one(mkve.Segment).then(s => s.one(mkve.Info)).then(i => i.toXML()));

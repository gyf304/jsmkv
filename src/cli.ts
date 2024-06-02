import minimist from "minimist";
import * as z from "zod";

import * as ebml from "./ebml";
import * as matroska from "./matroska";

const argsSchema = z.object({
	_: z.tuple([z.string()]).transform((args) => args[0]),
});

const args = argsSchema.parse(minimist(process.argv.slice(2)));

const ebmlStream = new ebml.Stream(new Blob([await Bun.file(args._).arrayBuffer()]));
const mkv = new matroska.File(ebmlStream);
console.log(await mkv.toXML());

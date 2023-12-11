import { BYOBlob } from "./byoblob";
import { MKV } from "./mkv";
import * as e from "./mkv/elements";
import { EBMLStream, EBMLElement } from "./ebml.js";

// const blob = new Blob(["hello world"]);
// console.log(await (new Blob(["hello world"])).slice(1).slice(1).text());

const mkvFilePath = Bun.argv[2];
const mkvFile = Bun.file(mkvFilePath);

const ebml = new EBMLStream(mkvFile);
const mkv = new MKV(ebml);

for await (const segment of mkv.segments) {
	console.log(segment.toString());
	for await (const seekHead of segment.seekHeads) {
		console.log(seekHead.toString());
		for await (const seek of seekHead.seeks) {
			console.log(seek.toString());
			const el = await seek.seekPosition.then((p) => p.referencedElement);
			console.log("  referenced", el.toString());
			if (el instanceof e.Cues) {
				console.log("    is cues");
				for await (const cuePoint of el.cuePoints) {
					console.log("      cue point", cuePoint.toString());
					for await (const cueTrackPositions of cuePoint.cueTrackPositions) {
						console.log("        cue track positions", cueTrackPositions.toString());
						console.log("          track", await cueTrackPositions.cueTrack.then(t => t.value));
						console.log("          cluster position", await cueTrackPositions.cueClusterPosition.then(t => t.value));
						const cluster = await cueTrackPositions.cueClusterPosition.then((p) => p.referencedElement);
						console.log("          cluster", cluster.toString());
					}
				}
			}
		}
	}
	console.log((await segment.info).toString());
	for await (const track of (await segment.tracks)?.tracks ?? []) {
		console.log(track.toString());
		console.log("  number", await track.trackNumber.then(t => t.value));
		console.log("  type", await track.trackType.then(t => t.value));
		console.log("  name", await track.name.then(t => t?.value));
	}
}

for await (const segment of mkv.segments) {
	const cues = await segment.getCues(true);
	if (cues === undefined) {
		continue;
	}
	for await (const cuePoint of cues.cuePoints) {
		for await (const cueTrackPositions of cuePoint.cueTrackPositions) {
			const cluster = await cueTrackPositions.cueClusterPosition.then((p) => p.referencedElement);
			console.log("cluster", cluster.toString());
		}
	}
}

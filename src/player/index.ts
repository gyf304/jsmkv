import { MseTrack } from "./mse.js";
import { Player } from "./player.js";
import { TextPlayerTrack } from "./text.js";

export { MseTrack, Player, TextPlayerTrack };
export { MediaSourceHandle, isMediaSourceTypeSupported } from "./media.js";
export type {
	CodecSupport,
	MediaTracksElement,
	PlayerMediaTrack,
	PlayerOptions,
	Track,
	TrackPlugin,
	TrackType,
} from "./types.js";

export const defaultTrackPlugins = [MseTrack, TextPlayerTrack] as const;

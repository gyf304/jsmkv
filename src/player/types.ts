import type {
	AudioTrack,
	AudioTrackList,
	VideoTrack,
	VideoTrackList,
} from "media-tracks";
import type * as mkve from "../matroska/elements/index.js";

export type TrackType = "video" | "audio" | "subtitle";

export interface CodecSupport {
	readonly codecType: TrackType;
	readonly codecId: string;
}

export interface Track<T extends PlayerMediaTrack> {
	readonly sink: T;
	/**
	 * Add a cluster to the track. After a seek, the player may send clusters
	 * beginning at any point at or before the requested position. Tracks must
	 * not assume the first cluster contains a keyframe. The player normally
	 * resumes from a cue/keyframe cluster for efficiency, but starting earlier
	 * is also valid.
	 */
	add(cluster: mkve.Cluster): Promise<void>;
	remove(start: number, end: number): Promise<void>;
}

export type PlayerMediaTrack = AudioTrack | VideoTrack | TextTrack;

export interface TrackPlugin<T extends PlayerMediaTrack = PlayerMediaTrack> {
	readonly supports: readonly CodecSupport[];
	mimeType(
		track: mkve.TrackEntry,
	): string | undefined | Promise<string | undefined>;
	create(
		track: mkve.TrackEntry,
		media: T,
	): Track<T> | Promise<Track<T>>;
}

export interface PlayerOptions {
	readonly maxBufferAhead?: number;
	readonly maxBufferBehind?: number;
}

export interface MediaTracksElement extends HTMLMediaElement {
	readonly audioTracks: AudioTrackList;
	readonly videoTracks: VideoTrackList;
	addAudioTrack(kind: string, label?: string, language?: string): AudioTrack;
	addVideoTrack(kind: string, label?: string, language?: string): VideoTrack;
	removeAudioTrack(track: AudioTrack): void;
	removeVideoTrack(track: VideoTrack): void;
}

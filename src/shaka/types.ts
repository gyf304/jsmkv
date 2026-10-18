import type shaka from "shaka-player";

export type ShakaNamespace = typeof import("shaka-player").default;
export type ShakaManifest = shaka.extern.Manifest;
export type ShakaManifestConfiguration = shaka.extern.ManifestConfiguration;
export type ShakaManifestParser = shaka.extern.ManifestParser;
export type ShakaPlayerInterface = shaka.extern.ManifestParser.PlayerInterface;
export type ShakaInitSegmentReference = shaka.media.InitSegmentReference;
export type ShakaSegmentReference = shaka.media.SegmentReference;
export type ShakaStream = shaka.extern.Stream;
export type ShakaTransmuxer = shaka.extern.Transmuxer;
export type ShakaTransmuxerOutput = shaka.extern.TransmuxerOutput;
export type ShakaVariant = shaka.extern.Variant;

# jsmkv

JSMKV is a suite of TypeScript tools for working with Matroska (MKV) files,
including a native MSE player.

P.S. this is not a production ready library. It should be considered a proof of concept.

P.P.S. If someone can recommend me a good MP4 validator, I would be very grateful.

## Demos
[Demo (MSE)](https://gyf304.github.io/jsmkv/player/): Native MSE player with pluggable track plugins.

## Limitations
- The player supports H.264/H.265 video, AAC/FLAC/Opus audio, and SRT/VTT subtitles.
- The library does not support all Matroska features. For example, videos not
  using SimpleBlock elements will not play.

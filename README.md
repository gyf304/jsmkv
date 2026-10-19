# jsmkv

JSMKV is a suite of TypeScript tools for working with Matroska (MKV) files,
including a Shaka Player integration.

P.S. this is not a production ready library. It should be considered a proof of concept.

P.P.S. If someone can recommend me a good MP4 validator, I would be very grateful.

## Demos
[Demo (Shaka)](https://gyf304.github.io/jsmkv/shaka/): Shaka Player using the matroska:// protocol.

## Limitations
- Only H.264/H.265 video and AAC audio are supported.
- Subtitle text and attachments are exposed, but attachment fonts are not registered with Shaka automatically.
- The library does not support all matroska features. e.g. videos not using
  SimpleBlock elements will not play.

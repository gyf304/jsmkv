# jsmkv

JSMKV is a in browser MKV (Matroska) file player and a suite of typescript
tools for working with Matroska files.

P.S. this is not a production ready library. It should be considered a proof of concept.

P.P.S. If someone can recommend me a good MP4 validator, I would be very grateful.

## Demo
[Demo (HTTP)](https://gyf304.github.io/jsmkv/demo-http.html): Video player streaming from a http/https server.

[Demo (File)](https://gyf304.github.io/jsmkv/demo-file.html): Video player streaming from a file input.

## Limitations
- The player does not support Safari. Safari rejects the fMP4 initialization
  segment generated by the library, and I have not yet figured out why.
- The player only supports H.264/H.265 video and AAC audio.
- The player does not (yet) support subtitles.
- The library does not support all matroska features. e.g. videos not using
  SimpleBlock elements will not play.

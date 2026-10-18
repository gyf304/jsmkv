import { player, bloblike } from "../../index.js";

const fileInput = document.getElementById("file-input");
fileInput?.addEventListener("change", async () => {
  let file = (fileInput as any).files[0];
  if (file) {
    file = new bloblike.CacheBlobLike(file);
    const mkvPlayer = new player.MKVVideoPlayer(
      file,
      document.getElementById("mkv-player") as any,
    );
  }
});

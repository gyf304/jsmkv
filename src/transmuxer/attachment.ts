import type { BlobLike } from "../bloblike/index.js";
import * as mkve from "../matroska/elements/index.js";

export class Attachment {
	public static async from(file: mkve.AttachedFile): Promise<Attachment> {
		return new Attachment(
			await file.fileName,
			await file.fileMediaType,
			await file.fileDescription,
			(await file.one(mkve.FileData)).element.data,
			await file.fileUID,
		);
	}

	private constructor(
		public readonly name: string,
		public readonly mediaType: string,
		public readonly description: string | undefined,
		public readonly data: BlobLike,
		public readonly uid: number,
	) {}
}

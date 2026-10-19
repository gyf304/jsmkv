export class CuePointTransmuxer {
	constructor(
		public readonly startTime: number,
		public readonly endTime: number,
		private readonly factory: () => AsyncGenerator<Uint8Array>,
	) {}

	public streamFragments(): AsyncGenerator<Uint8Array> {
		return this.factory();
	}
}

import { describe, expect, it } from "bun:test";
import { buildChoices, type VideoInfo } from "../src/lib/ytdlp";

const FIXTURE: VideoInfo = {
	id: "abc",
	title: "Sample",
	formats: [
		{ format_id: "audio", acodec: "opus", vcodec: "none", abr: 128 },
		{ format_id: "v360", vcodec: "avc1", acodec: "none", height: 360, tbr: 500 },
		{ format_id: "v720", vcodec: "avc1", acodec: "none", height: 720, tbr: 1500 },
		{ format_id: "v1080", vcodec: "avc1", acodec: "none", height: 1080, tbr: 3000 },
	],
};

describe("buildChoices", () => {
	it("defaults to all heights and mp3 audio", () => {
		const choices = buildChoices(FIXTURE);
		const video = choices.filter((c) => c.kind === "video").map((c) => c.quality);
		expect(video).toEqual(["1080p", "720p", "360p"]);
		expect(choices.find((c) => c.kind === "audio")?.id).toBe("a-mp3");
	});

	it("uses yoinks-style video labels", () => {
		const choices = buildChoices(FIXTURE);
		const video = choices.find((c) => c.quality === "1080p");
		expect(video?.label).toMatch(/^1080p · mp4/);
	});

	it("uses yoinks-style audio label", () => {
		const choices = buildChoices(FIXTURE);
		const audio = choices.find((c) => c.kind === "audio");
		expect(audio?.label).toMatch(/^audio only · mp3/);
	});
});

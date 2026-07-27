import { describe, expect, it } from "bun:test";
import { validateUrl } from "./validation";

describe("validateUrl", () => {
	it("should accept URLs from the services shown in the UI", () => {
		expect(validateUrl("https://www.tiktok.com/@user/video/1234567890").valid).toBe(true);
		expect(validateUrl("https://x.com/user/status/1234567890").valid).toBe(true);
		expect(validateUrl("https://twitter.com/user/status/1234567890").valid).toBe(true);
		expect(validateUrl("https://youtu.be/jNQXAC9IVRw").valid).toBe(true);
		expect(validateUrl("https://vimeo.com/357274789").valid).toBe(true);
	});

	it("should accept any other public host — yt-dlp decides what it can extract", () => {
		expect(validateUrl("https://example.com/video/1").valid).toBe(true);
		expect(validateUrl("https://www.threads.com/@user/post/ABC").valid).toBe(true);
		expect(validateUrl("https://some-tiny-video-host.co.uk/v/42").valid).toBe(true);
	});

	it("should refuse private, loopback and link-local hosts", () => {
		const internal = [
			"http://localhost:3001/x",
			"http://app:3001/x",
			"http://127.0.0.1/x",
			"http://10.0.0.5/x",
			"http://172.16.0.1/x",
			"http://192.168.1.1/x",
			"http://169.254.169.254/latest/meta-data/",
			"http://100.64.0.1/x",
			"http://[::1]/x",
			"http://[fd00::1]/x",
			"http://[fe80::1]/x",
			"http://[::ffff:127.0.0.1]/x",
			"http://printer.local/x",
			"http://db.internal/x",
		];
		for (const url of internal) {
			const result = validateUrl(url);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("private or internal");
		}
	});

	it("should refuse loopback hosts hidden by URL normalization or a root dot", () => {
		expect(validateUrl("http://2130706433/x").valid).toBe(false);
		expect(validateUrl("http://0x7f.1/x").valid).toBe(false);
		expect(validateUrl("http://localhost./x").valid).toBe(false);
		expect(validateUrl("http://printer.local./x").valid).toBe(false);
	});

	it("should still accept a public host that merely looks unusual", () => {
		expect(validateUrl("https://8.8.8.8/video.mp4").valid).toBe(true);
		expect(validateUrl("https://local.example.com/v/1").valid).toBe(true);
	});

	it("should reject empty URLs", () => {
		expect(validateUrl("").valid).toBe(false);
	});

	it("should reject invalid protocols", () => {
		expect(validateUrl("ftp://example.com").valid).toBe(false);
	});

	it("should reject URLs containing whitespace", () => {
		expect(validateUrl("https://x.com/ user").valid).toBe(false);
	});

	it("should accept URLs with multiple query parameters", () => {
		expect(validateUrl("https://x.com/i/status/1?a=1&b=2").valid).toBe(true);
	});

	it("should reject invalid URL format", () => {
		expect(validateUrl("not-a-url").valid).toBe(false);
	});
});

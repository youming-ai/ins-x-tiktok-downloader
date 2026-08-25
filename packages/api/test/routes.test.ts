import { describe, expect, it } from "bun:test";
import app from "../src/app";

process.env.PROXY_SIGNING_KEY = "test-key";

describe("API Routes", () => {
	describe("POST /api/resolve", () => {
		it("should reject invalid URLs with 400", async () => {
			const res = await app.fetch(
				new Request("http://localhost:3001/api/resolve", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ url: "not a url" }),
				}),
			);
			expect(res.status).toBe(400);
			const data = (await res.json()) as { success: boolean; error: string };
			expect(data.success).toBe(false);
		});

		it("should ignore unknown fields and validate only the URL", async () => {
			const res = await app.fetch(
				new Request("http://localhost:3001/api/resolve", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						url: "not a url",
						videoQuality: "not-a-quality",
					}),
				}),
			);
			expect(res.status).toBe(400);
			const data = (await res.json()) as { success: boolean };
			expect(data.success).toBe(false);
		});
	});

	describe("GET /api/info", () => {
		it("should return yt-dlp engine metadata", async () => {
			const res = await app.fetch(new Request("http://localhost:3001/api/info"));
			expect(res.status).toBe(200);
			const data = (await res.json()) as { engine: string };
			expect(data.engine).toBe("yt-dlp");
		});
	});

	describe("GET /api/download/progress", () => {
		it("should reject requests without a signature", async () => {
			const res = await app.fetch(
				new Request(
					"http://localhost:3001/api/download/progress?url=https://x.com/user/status/1&choiceId=a-mp3&infoJson=/tmp/x.json",
				),
			);
			expect(res.status).toBe(400);
		});

		it("should reject a tampered info-json path (bad signature)", async () => {
			const res = await app.fetch(
				new Request(
					"http://localhost:3001/api/download/progress?url=https://x.com/user/status/1&choiceId=a-mp3&infoJson=/etc/passwd&sig=deadbeef",
				),
			);
			expect(res.status).toBe(403);
		});
	});

	describe("GET /api/download", () => {
		it("should reject requests without a signature", async () => {
			const res = await app.fetch(
				new Request("http://localhost:3001/api/download?file=/tmp/video.mp4"),
			);
			expect(res.status).toBe(400);
		});

		it("should reject a tampered file path (bad signature)", async () => {
			const res = await app.fetch(
				new Request("http://localhost:3001/api/download?file=/etc/passwd&sig=deadbeef"),
			);
			expect(res.status).toBe(403);
		});
	});

	describe("GET /health", () => {
		it("should return health OK", async () => {
			const res = await app.fetch(new Request("http://localhost:3001/health"));
			expect(res.status).toBe(200);
			const text = await res.text();
			expect(text).toBe("OK");
		});
	});
});

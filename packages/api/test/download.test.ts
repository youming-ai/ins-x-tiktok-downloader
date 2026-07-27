import { beforeEach, describe, expect, it } from "bun:test";
import app from "../src/app";
import { clearClients } from "../src/middleware/rate-limit";

describe("POST /api/resolve validation", () => {
	beforeEach(() => {
		clearClients();
	});

	it("returns 400 when body is missing or invalid JSON", async () => {
		const res = await app.fetch(
			new Request("http://localhost:3001/api/resolve", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{ invalid json",
			}),
		);
		expect(res.status).toBe(400);
	});

	it("returns 400 when URL is missing", async () => {
		const res = await app.fetch(
			new Request("http://localhost:3001/api/resolve", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("returns 400 when the host is private or internal", async () => {
		const res = await app.fetch(
			new Request("http://localhost:3001/api/resolve", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data/" }),
			}),
		);
		expect(res.status).toBe(400);
	});
});

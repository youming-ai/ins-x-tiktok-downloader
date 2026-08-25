function parseHttpUrl(url: string): URL | null {
	try {
		const parsed = new URL(url.trim());
		return ["http:", "https:"].includes(parsed.protocol) ? parsed : null;
	} catch {
		return null;
	}
}

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/** `new URL()` has already normalized decimal/octal/hex forms to a dotted quad. */
function isPrivateIpv4(host: string): boolean {
	const octets = IPV4_REGEX.exec(host);
	if (!octets) return false;
	const a = Number(octets[1]);
	const b = Number(octets[2]);
	if (a === 0 || a === 10 || a === 127) return true;
	if (a >= 224) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	return false;
}

function isPrivateIpv6(inner: string): boolean {
	if (inner === "::" || inner === "::1") return true;
	// IPv4-mapped (`::ffff:7f00:1`) reaches the v4 loopback and private ranges.
	if (inner.startsWith("::ffff:")) return true;
	const group = inner.split(":")[0] ?? "";
	if (group.length !== 4) return false;
	// fc00::/7 unique-local, fe80::/10 link-local.
	return group.startsWith("fc") || group.startsWith("fd") || /^fe[89ab]/.test(group);
}

function isInternalHost(rawHost: string): boolean {
	// A trailing root dot is legal and survives `new URL()` normalization, so
	// `localhost.` and `printer.local.` would otherwise slip past both the
	// single-label and the suffix check below.
	const host = rawHost.replace(/\.$/, "");
	if (host.startsWith("[")) return isPrivateIpv6(host.slice(1, -1));
	if (isPrivateIpv4(host)) return true;
	// Single-label names only resolve inside a network — `localhost`, or a
	// sibling container's service name on the deploy network. No public media
	// host looks like this.
	if (!host.includes(".")) return true;
	return INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Accept any public http(s) URL — yt-dlp reaches ~1,800 sites and is the only
 * thing that can say what it actually supports, so snatch does not keep a host
 * allowlist.
 *
 * Private, loopback, link-local and single-label hosts are refused: a pasted
 * `http://10.0.0.5/` or `http://app:3001/` has no business reaching the engine.
 * This is a cheap filter on the literal hostname, not a network boundary — it
 * cannot see a public name that resolves to a private address, DNS rebinding,
 * or the redirects yt-dlp follows on its own.
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
	if (!url || typeof url !== "string") {
		return { valid: false, error: "URL is required" };
	}

	const trimmed = url.trim();

	if (/\s/.test(trimmed)) {
		return {
			valid: false,
			error: "URL contains invalid characters. Only standard URL characters are allowed.",
		};
	}

	const parsed = parseHttpUrl(trimmed);
	if (!parsed) {
		return { valid: false, error: "Invalid URL format" };
	}

	const host = parsed.hostname.toLowerCase();
	if (isInternalHost(host)) {
		return { valid: false, error: `Refusing to fetch from a private or internal host: '${host}'` };
	}

	return { valid: true };
}

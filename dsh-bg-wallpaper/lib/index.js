import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
//#region src/settings.ts
/** Durable background-image settings — pure constants/types shared by both halves. */
/** Settings namespace owned by the background-image plugin. */
const BACKGROUND_SETTINGS_NAMESPACE = "ui-background";
/** Minimum scrim opacity (0 = no veil at all). */
const SCRIM_MIN = 0;
/** Maximum scrim opacity (a nearly opaque veil keeps text legible over any art). */
const SCRIM_MAX = .95;
/** Default scrim strength applied over user art (a light readability veil). */
const DEFAULT_SCRIM = .25;
/** Default background image opacity (1 = fully opaque). */
const DEFAULT_OPACITY = 1;
/** Minimum background image opacity (0 = fully invisible). */
const OPACITY_MIN = 0;
/** Maximum background image opacity (1 = fully opaque). */
const OPACITY_MAX = 1;
/** Default background rendering mode. */
const DEFAULT_FIT = "cover";
/** Image positioning modes. `cover` fills the frame (cropping as needed); `contain` fits the whole image inside the frame (letterboxing). */
const FIT_MODES = ["cover", "contain"];
//#endregion
//#region src/schema.ts
/** Host-side schema for the `ui-background` settings namespace. */
/**
* Durable background section; also the wire envelope the browser scope
* validates against. URLs are free strings (remote http(s) or any URL the
* browser can load); the schema stays structural (no trim/transform — a
* function callback would break the schema's toJSON wire serialization).
*/
const BackgroundSettingsSchema = z.object({
	enabled: z.boolean().default(false),
	lightUrl: z.string().default(""),
	darkUrl: z.string().default(""),
	opacity: z.number().min(0).max(1).default(1),
	scrim: z.number().min(0).max(SCRIM_MAX).default(DEFAULT_SCRIM),
	fit: z.union([...FIT_MODES]).default(DEFAULT_FIT)
});
//#endregion
//#region src/routes.ts
/** Browser-facing base path of the background API. */
const BACKGROUND_API_PREFIX = "/api/bg-wallpaper";
/** Resolved section when the stored document has no user layer. */
const DEFAULTS = {
	enabled: false,
	lightUrl: "",
	darkUrl: "",
	opacity: 1,
	scrim: DEFAULT_SCRIM,
	fit: DEFAULT_FIT
};
/** One JSON response. */
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
/** Require the method or answer 405. */
function requireMethod(req, res, method) {
	if (req.method === method) return true;
	json(res, 405, {
		ok: false,
		error: "method-not-allowed"
	});
	return false;
}
/**
* Same-origin fence. Browsers send `Sec-Fetch-Site` on every fetch; a
* cross-site fetch is always rejected, and an `Origin` that does not match
* the request `Host` is rejected. Requests without either header (curl, node
* http) pass — this is a local single-user tool, and the fence only targets
* the cross-site browser vector.
*/
function isSameOriginRequest(req) {
	const site = req.headers["sec-fetch-site"];
	if (typeof site === "string" && site === "cross-site") return false;
	const origin = req.headers.origin;
	if (typeof origin === "string" && origin !== "" && origin !== "null") {
		const host = req.headers.host;
		if (typeof host !== "string" || host === "") return false;
		try {
			return new URL(origin).host === host;
		} catch {
			return false;
		}
	}
	return true;
}
/** Read the raw request body (JSON, bounded). */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 65536) {
				reject(/* @__PURE__ */ new Error("body-too-large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const text = Buffer.concat(chunks).toString("utf8");
				resolve(text === "" ? {} : JSON.parse(text));
			} catch {
				reject(/* @__PURE__ */ new Error("invalid-json"));
			}
		});
		req.on("error", reject);
	});
}
/** One background API route family over the settings provider. */
function makeBackgroundRoutes(settings) {
	const readSection = () => {
		return settings.get("ui-background") ?? { ...DEFAULTS };
	};
	return [{
		kind: "exact",
		path: `${BACKGROUND_API_PREFIX}/settings`,
		handler: async (req, res) => {
			if (!isSameOriginRequest(req)) {
				json(res, 403, {
					ok: false,
					error: "cross-site-request-rejected"
				});
				return;
			}
			if (req.method === "GET") {
				json(res, 200, {
					ok: true,
					value: readSection()
				});
				return;
			}
			if (req.method === "POST") {
				if (!requireMethod(req, res, "POST")) return;
				try {
					const body = await readJsonBody(req);
					await settings.update(BACKGROUND_SETTINGS_NAMESPACE, body);
					json(res, 200, {
						ok: true,
						value: readSection()
					});
				} catch (error) {
					json(res, 400, {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					});
				}
				return;
			}
			json(res, 405, {
				ok: false,
				error: "method-not-allowed"
			});
		}
	}];
}
//#endregion
//#region src/index.ts
const BACKGROUND_NAMESPACE = settingsNamespace(BACKGROUND_SETTINGS_NAMESPACE);
/**
* Register the durable background section and its API routes when the Host
* settings/webServer services are composed. Effect timing is `live`: the
* browser half repaints through the route without a restart.
* @param ctx - Host context that may acquire the settings and webServer services.
*/
function apply(ctx) {
	ctx.inject(["settings", "webServer"], (hostCtx) => {
		hostCtx.settings.register(BACKGROUND_NAMESPACE, BackgroundSettingsSchema, { applies: "live" });
		try {
			for (const route of makeBackgroundRoutes(hostCtx.settings)) hostCtx.effect(() => hostCtx.webServer.register(route), "dsh-bg-wallpaper: settings route");
		} catch (error) {
			console.error("[dsh-bg-wallpaper] route registration failed:", error);
		}
	});
}
//#endregion
export { BACKGROUND_API_PREFIX, BACKGROUND_SETTINGS_NAMESPACE, BackgroundSettingsSchema, DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_SCRIM, FIT_MODES, OPACITY_MAX, OPACITY_MIN, SCRIM_MAX, SCRIM_MIN, apply, makeBackgroundRoutes };

//#region src/widget/config.js
var e = Object.freeze({
	system: {
		label: "System",
		css: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
	},
	sans: {
		label: "Classic sans",
		css: "Arial, Helvetica, sans-serif"
	},
	humanist: {
		label: "Humanist",
		css: "Trebuchet MS, Arial, sans-serif"
	},
	serif: {
		label: "Editorial",
		css: "Georgia, Times New Roman, serif"
	},
	mono: {
		label: "Monospace",
		css: "ui-monospace, SFMono-Regular, Consolas, monospace"
	},
	rounded: {
		label: "Rounded",
		css: "ui-rounded, \"SF Pro Rounded\", \"Nunito\", \"Varela Round\", system-ui, sans-serif"
	},
	geometric: {
		label: "Geometric",
		css: "Avenir, \"Avenir Next\", Montserrat, \"Century Gothic\", sans-serif"
	},
	inherit: {
		label: "Match your website",
		css: "inherit"
	},
	custom: {
		label: "Custom font name",
		css: ""
	}
}), t = Object.freeze({
	auto: "Logo, or speech bubble",
	message: "Speech bubble",
	lightbulb: "Light bulb",
	help: "Question mark",
	megaphone: "Megaphone",
	heart: "Heart"
});
function n(t) {
	return t.font === "custom" ? `${t.customFont}, system-ui, sans-serif` : e[t.font].css;
}
var r = Object.freeze({
	version: 2,
	title: "Help us make this better",
	greeting: "Share an idea, report a problem, or show us what happened.",
	launcherText: "Feedback",
	submitText: "Send feedback",
	successMessage: "Thanks! Your feedback is with our team.",
	accent: "#087F74",
	background: "#FFFFFF",
	textColor: "#18332F",
	logoUrl: "",
	font: "system",
	position: "right",
	launcherStyle: "circle",
	launcherIcon: "auto",
	headerStyle: "accent",
	panelWidth: 380,
	customFont: "",
	categories: Object.freeze([
		"feature",
		"bug",
		"question",
		"praise"
	]),
	aiEnabled: !1,
	aiName: "Assistant",
	aiIntro: "Hi! Ask me anything. If I can’t help, I’ll pass it to the team.",
	links: Object.freeze([]),
	radius: 18,
	offset: 24,
	desktopOffsetX: 24,
	desktopOffsetY: 24,
	mobileOffsetX: 16,
	mobileOffsetY: 88,
	mobilePosition: "inherit",
	theme: "light",
	collectEmail: "optional",
	showBranding: !0,
	allowedOrigins: [],
	endpoint: "",
	delivery: "custom",
	appSiteId: "",
	capture: Object.freeze({
		image: !0,
		voice: !0,
		video: !0,
		screen: !0,
		screenshot: !0,
		element: !0
	})
});
function i(e, t, n) {
	let r = typeof e == "string" ? e.trim() : t;
	if (r.length > n) throw Error(`Keep widget text under ${n} characters.`);
	return r;
}
function a(e, t) {
	let n = e || t;
	if (!/^#[a-f\d]{6}$/i.test(n)) throw Error("Choose a six-digit hex color.");
	return n;
}
function o(e, { local: t = !1 } = {}) {
	if (!e) return "";
	let n = new URL(e);
	if (n.username || n.password || n.hash) throw Error("Use a URL without credentials or a fragment.");
	if (n.protocol !== "https:" && !(t && [
		"localhost",
		"127.0.0.1",
		"[::1]"
	].includes(n.hostname) && n.protocol === "http:")) throw Error("Use an HTTPS URL.");
	return n.href;
}
function s(e = "") {
	if (typeof e != "string") throw Error("Use an image URL or select an image file.");
	if (!e.startsWith("data:")) return o(e);
	let t = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(e);
	if (!t || e.length > 33e3) throw Error("Select a PNG, JPG or WebP logo, or paste an HTTPS image URL.");
	let n;
	try {
		n = atob(t[2]);
	} catch {
		throw Error("The selected logo could not be read.");
	}
	if (!(t[1] === "png" ? n.startsWith("PNG\r\n\n") : t[1] === "jpeg" ? n.startsWith("ÿØÿ") : n.startsWith("RIFF") && n.slice(8, 12) === "WEBP")) throw Error("The selected logo is not a valid image.");
	return e;
}
function c(e) {
	let t = o(e || "", { local: !0 });
	if (t && new URL(t).search) throw Error("Use a public submission URL without query parameters or access tokens.");
	return t;
}
function l(e) {
	let t = Array.isArray(e) ? e : [];
	if (t.length > 4) throw Error("Use at most 4 help links.");
	return t.map((e) => ({
		label: typeof e?.label == "string" ? e.label.trim() : "",
		url: typeof e?.url == "string" ? e.url.trim() : ""
	})).filter((e) => e.label || e.url).map((e) => {
		if (!e.label || !e.url || e.label.length > 40) throw Error("Give each help link a label (up to 40 characters) and a URL.");
		try {
			return {
				label: e.label,
				url: o(e.url)
			};
		} catch {
			throw Error(`Use an HTTPS address for “${e.label}”.`);
		}
	});
}
function u(e) {
	let t = typeof e == "string" ? e.trim() : "";
	if (t.length > 128 || t && !/^[A-Za-z0-9_-]+$/.test(t)) throw Error("Use an App site ID with letters, numbers, underscores or hyphens.");
	return t;
}
function d(n = {}) {
	let d = n;
	if (typeof n == "string") try {
		d = JSON.parse(n || "{}");
	} catch {
		throw Error("The saved widget settings could not be read.");
	}
	if (!d || typeof d != "object" || Array.isArray(d)) throw Error("Invalid widget settings.");
	let f = r, p = Object.hasOwn(d, "offset") ? d.offset : void 0, m = (e, t) => Number(d[e] ?? p ?? t), h = {
		version: 2,
		title: i(d.title, f.title, 100),
		greeting: i(d.greeting, f.greeting, 300),
		launcherText: i(d.launcherText, f.launcherText, 32),
		submitText: i(d.submitText, f.submitText, 40),
		successMessage: i(d.successMessage, f.successMessage, 200),
		accent: a(d.accent, f.accent),
		background: a(d.background, f.background),
		textColor: a(d.textColor, f.textColor),
		logoUrl: s(d.logoUrl || ""),
		font: d.font || f.font,
		position: d.position || f.position,
		launcherStyle: d.launcherStyle || f.launcherStyle,
		launcherIcon: d.launcherIcon || f.launcherIcon,
		headerStyle: d.headerStyle || f.headerStyle,
		panelWidth: Number(d.panelWidth ?? f.panelWidth),
		customFont: i(d.customFont, f.customFont, 120),
		theme: d.theme || f.theme,
		aiEnabled: d.aiEnabled === !0,
		aiName: i(d.aiName, f.aiName, 40) || f.aiName,
		aiIntro: i(d.aiIntro, f.aiIntro, 240) || f.aiIntro,
		links: l(d.links),
		categories: Array.isArray(d.categories) ? f.categories.filter((e) => d.categories.includes(e)) : [...f.categories],
		radius: Number(d.radius ?? f.radius),
		offset: Number(d.offset ?? f.offset),
		desktopOffsetX: m("desktopOffsetX", f.desktopOffsetX),
		desktopOffsetY: m("desktopOffsetY", f.desktopOffsetY),
		mobileOffsetX: m("mobileOffsetX", f.mobileOffsetX),
		mobileOffsetY: m("mobileOffsetY", f.mobileOffsetY),
		mobilePosition: d.mobilePosition ?? f.mobilePosition,
		collectEmail: d.collectEmail || f.collectEmail,
		showBranding: d.showBranding !== !1,
		allowedOrigins: [...new Set((Array.isArray(d.allowedOrigins) ? d.allowedOrigins : []).filter(Boolean).map((e) => new URL(o(e, { local: !0 })).origin))],
		endpoint: c(d.endpoint || ""),
		delivery: d.delivery || "custom",
		appSiteId: u(d.appSiteId),
		capture: Object.fromEntries(Object.keys(f.capture).map((e) => [e, d.delivery !== "builtin" && d.capture?.[e] !== !1]))
	};
	if (!h.title || !h.launcherText || !h.submitText || !h.successMessage) throw Error("Add a title, button labels, and a thank-you message.");
	if (!Object.hasOwn(e, h.font) || !["right", "left"].includes(h.position) || ![
		"inherit",
		"right",
		"left"
	].includes(h.mobilePosition) || !["light", "dark"].includes(h.theme) || ![
		"off",
		"optional",
		"required"
	].includes(h.collectEmail) || !["builtin", "custom"].includes(h.delivery) || !["circle", "pill"].includes(h.launcherStyle) || !Object.hasOwn(t, h.launcherIcon) || !["accent", "plain"].includes(h.headerStyle)) throw Error("Choose a supported widget option.");
	if (!h.categories.length) throw Error("Offer at least one feedback type.");
	if (!Number.isInteger(h.panelWidth) || h.panelWidth < 320 || h.panelWidth > 460) throw Error("Choose a panel width between 320 and 460px.");
	if (h.font === "custom" && !/^[A-Za-z0-9 ,'"-]{1,120}$/.test(h.customFont)) throw Error("Enter a font name using letters, numbers, spaces, commas, quotes or hyphens.");
	if (!Number.isInteger(h.radius) || h.radius < 0 || h.radius > 28 || [
		h.offset,
		h.desktopOffsetX,
		h.desktopOffsetY,
		h.mobileOffsetX,
		h.mobileOffsetY
	].some((e) => !Number.isInteger(e) || e < 8 || e > 240)) throw Error("Choose a supported corner radius and edge spacing.");
	if (h.allowedOrigins.length > 20) throw Error("Use at most 20 website origins.");
	return h;
}
function f(e) {
	let t = e.slice(1).match(/../g).map((e) => parseInt(e, 16) / 255).map((e) => e <= .04045 ? e / 12.92 : ((e + .055) / 1.055) ** 2.4);
	return t[0] * .2126 + t[1] * .7152 + t[2] * .0722 > .179 ? "#142A25" : "#FFFFFF";
}
//#endregion
//#region src/widget/placement.js
var p = 600;
function m(e) {
	return Number.isFinite(e) ? Math.max(0, e) : 0;
}
function h(e, t, n) {
	return Math.max(t, Math.min(e, n));
}
function g(e, t) {
	let n = m(t) <= p;
	return {
		mobile: n,
		position: n && e.mobilePosition !== "inherit" ? e.mobilePosition : e.position,
		offsetX: n ? e.mobileOffsetX : e.desktopOffsetX,
		offsetY: n ? e.mobileOffsetY : e.desktopOffsetY
	};
}
function ee({ viewportWidth: e, viewportHeight: t, offsetX: n, offsetY: r, panelWidth: i, launcherSize: a = 56, launcherGap: o = 8, panelGutter: s = 8, minimumPanelWidth: c = 280, minimumPanelHeight: l = 160 } = {}) {
	let u = m(e), d = m(t), f = m(n), p = m(r), g = m(a), ee = m(o), _ = m(s), v = Math.min(m(c), Math.max(0, u - _)), y = Math.min(m(l), Math.max(0, d - _)), b = h(f, 0, Math.max(0, u - g)), x = h(p, 0, Math.max(0, d - g)), S = h(f, 0, Math.max(0, u - v - _)), te = h(p + g + ee, 0, Math.max(0, d - y - _));
	return {
		launcherInsetX: b,
		launcherInsetY: x,
		panelInsetX: S,
		panelInsetY: te,
		panelMaxWidth: Math.max(0, Math.min(m(i), u - S - _)),
		panelMaxHeight: Math.max(0, d - te - _)
	};
}
//#endregion
//#region src/widget/capture.js
var _ = Object.freeze({
	maxFiles: 5,
	maxFileBytes: 20971520,
	maxTotalBytes: 41943040,
	maxRecordingSeconds: 120
}), v = Object.freeze(/* @__PURE__ */ new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"audio/webm",
	"audio/ogg",
	"audio/mp4",
	"audio/mpeg",
	"audio/wav",
	"video/webm",
	"video/mp4",
	"video/quicktime"
])), y = Object.freeze({
	voice: [
		"audio/webm;codecs=opus",
		"audio/ogg;codecs=opus",
		"audio/mp4;codecs=mp4a.40.2",
		"audio/webm",
		"audio/ogg",
		"audio/mp4"
	],
	video: [
		"video/webm;codecs=vp9,opus",
		"video/webm;codecs=vp8,opus",
		"video/mp4;codecs=avc1.42E01E,mp4a.40.2",
		"video/webm",
		"video/mp4"
	]
}), b = Object.freeze({
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"audio/webm": "webm",
	"audio/ogg": "ogg",
	"audio/mp4": "m4a",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
	"video/webm": "webm",
	"video/mp4": "mp4",
	"video/quicktime": "mov"
});
function x(e, t) {
	let n = Error(e);
	return n.code = t, n;
}
function S(e) {
	return String(e || "").split(";", 1)[0].trim().toLowerCase();
}
function te(e, t = []) {
	if (!e || typeof e != "object" || typeof e.size != "number") throw x("Choose a valid attachment.", "INVALID_ATTACHMENT");
	if (!Array.isArray(t)) throw x("Existing attachments must be a list.", "INVALID_ATTACHMENT_LIST");
	if (t.length >= _.maxFiles) throw x(`You can attach up to ${_.maxFiles} files.`, "TOO_MANY_ATTACHMENTS");
	let n = S(e.type);
	if (!v.has(n)) throw x("Use a PNG, JPEG, WebP, supported audio file, or supported video file. SVG files are not allowed.", "UNSUPPORTED_ATTACHMENT_TYPE");
	if (!Number.isFinite(e.size) || e.size <= 0) throw x("The attachment is empty.", "EMPTY_ATTACHMENT");
	if (e.size > _.maxFileBytes) throw x("Each attachment must be 20 MB or smaller.", "ATTACHMENT_TOO_LARGE");
	if (t.reduce((e, t) => {
		let n = Number(t?.size);
		return e + (Number.isFinite(n) && n > 0 ? n : 0);
	}, 0) + e.size > _.maxTotalBytes) throw x("Attachments must total 40 MB or less.", "ATTACHMENTS_TOO_LARGE");
	return e;
}
function C(e, ...t) {
	if (typeof e == "function") try {
		e(...t);
	} catch {}
}
function w(e) {
	for (let t of e?.getTracks?.() || []) {
		t.onended = null;
		try {
			t.stop();
		} catch {}
	}
}
function ne(e, t) {
	return e?.name === "NotAllowedError" || e?.name === "SecurityError" ? x(`${t === "voice" ? "Microphone" : t === "video" ? "Camera and microphone" : "Screen sharing"} permission was not granted.`, "CAPTURE_PERMISSION_DENIED") : e?.name === "NotFoundError" || e?.name === "DevicesNotFoundError" ? x(`No available ${t === "voice" ? "microphone" : t === "video" ? "camera or microphone" : "screen source"} was found.`, "CAPTURE_DEVICE_MISSING") : e?.name === "NotReadableError" || e?.name === "TrackStartError" ? x("The selected device or screen could not be started. Close other apps using it and try again.", "CAPTURE_DEVICE_BUSY") : e?.name === "AbortError" ? x("Capture was cancelled before it started.", "CAPTURE_ABORTED") : e instanceof Error ? e : x("Capture could not start.", "CAPTURE_FAILED");
}
function re(e, t) {
	let n = y[e === "voice" ? "voice" : "video"];
	return typeof t.isTypeSupported == "function" && n.find((e) => t.isTypeSupported(e)) || "";
}
function T(e, t) {
	return `feedback-${e}-${(/* @__PURE__ */ new Date()).toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}.${b[S(t)] || "webm"}`;
}
function E(e, t) {
	return t?.aborted ? Promise.reject(x("Screenshot capture was cancelled.", "CAPTURE_ABORTED")) : e.readyState >= 2 && e.videoWidth > 0 ? Promise.resolve() : new Promise((n, r) => {
		let i = setTimeout(() => {
			a(), r(x("The shared screen did not produce an image.", "SCREENSHOT_UNAVAILABLE"));
		}, 1e4), a = () => {
			clearTimeout(i), e.removeEventListener("loadeddata", o), e.removeEventListener("error", s), t?.removeEventListener("abort", c);
		}, o = () => {
			a(), n();
		}, s = () => {
			a(), r(x("The shared screen did not produce an image.", "SCREENSHOT_UNAVAILABLE"));
		}, c = () => {
			a(), r(x("Screenshot capture was cancelled.", "CAPTURE_ABORTED"));
		};
		e.addEventListener("loadeddata", o, { once: !0 }), e.addEventListener("error", s, { once: !0 }), t?.addEventListener("abort", c, { once: !0 });
	});
}
function D(e) {
	return new Promise((t, n) => {
		e.toBlob((e) => {
			e ? t(e) : n(x("The screenshot could not be encoded.", "SCREENSHOT_ENCODE_FAILED"));
		}, "image/png");
	});
}
function ie({ onState: e, onRecording: t, onError: n } = {}) {
	let r = 0, i = !1, a = "idle", o = null;
	function s(t, n = null, r = {}) {
		a = t, C(e, Object.freeze({
			status: t,
			kind: n,
			...r
		}));
	}
	function c(e) {
		return C(n, e), !1;
	}
	function l(e) {
		if (i) return c(x("Capture is no longer available.", "CAPTURE_DISPOSED"));
		if (a !== "idle") return c(x("Another capture is already in progress.", "CAPTURE_IN_PROGRESS"));
		let t = globalThis.navigator?.mediaDevices;
		return t ? e === "screen" && typeof t.getDisplayMedia != "function" ? c(x("This browser does not support screen capture.", "SCREEN_CAPTURE_UNSUPPORTED")) : e !== "screen" && typeof t.getUserMedia != "function" ? c(x("This browser does not support camera or microphone capture.", "USER_MEDIA_UNSUPPORTED")) : !0 : c(x("This browser does not support media capture.", "CAPTURE_UNSUPPORTED"));
	}
	function u(e, t = "idle") {
		o === e && (clearTimeout(e.timer), clearInterval(e.ticker), e.abort?.abort(), w(e.stream), o = null, i || s(t));
	}
	async function d(e, n) {
		if (!l(e)) return !1;
		let a = globalThis.MediaRecorder;
		if (typeof a != "function") return c(x("This browser does not support recording.", "MEDIA_RECORDER_UNSUPPORTED"));
		let d = ++r;
		s("requesting", e);
		let f;
		try {
			if (f = await n(), i || d !== r) return w(f), !1;
			let l = re(e, a), p;
			try {
				p = new a(f, l ? { mimeType: l } : void 0);
			} catch {
				throw x("This browser could not create a compatible recording.", "RECORDING_FORMAT_UNSUPPORTED");
			}
			let m = {
				generation: d,
				kind: e,
				stream: f,
				recorder: p,
				chunks: [],
				bytes: 0,
				startedAt: Date.now(),
				timer: null,
				ticker: null,
				discard: !1,
				sizeExceeded: !1
			};
			o = m, p.addEventListener("dataavailable", (e) => {
				if (e.data?.size > 0 && (m.chunks.push(e.data), m.bytes += e.data.size, m.bytes > _.maxFileBytes && !m.sizeExceeded)) {
					m.sizeExceeded = !0;
					try {
						p.stop();
					} catch {}
				}
			}), p.addEventListener("error", (e) => {
				m.discard = !0, c(e.error || x("Recording failed.", "RECORDING_FAILED")), u(m);
			}), p.addEventListener("stop", () => {
				let n = Math.min(Date.now() - m.startedAt, _.maxRecordingSeconds * 1e3);
				if (!m.discard && o === m) {
					if (m.sizeExceeded || m.bytes > _.maxFileBytes) c(x("The recording reached the 20 MB attachment limit.", "RECORDING_TOO_LARGE"));
					else if (m.bytes > 0) {
						let r = S(p.mimeType || m.chunks[0]?.type || l) || (e === "voice" ? "audio/webm" : "video/webm"), i = new Blob(m.chunks, { type: r }), a = new File([i], T(e, r), {
							type: r,
							lastModified: Date.now()
						});
						try {
							te(a), C(t, a, Object.freeze({
								kind: e,
								durationMs: n
							}));
						} catch (e) {
							c(e);
						}
					} else c(x("The recording did not contain any media.", "EMPTY_RECORDING"));
				}
				u(m);
			});
			for (let e of f.getTracks()) e.onended = () => {
				if (o === m && p.state !== "inactive") try {
					p.stop();
				} catch {
					u(m);
				}
			};
			return p.start(1e3), m.startedAt = Date.now(), m.ticker = setInterval(() => {
				o === m && p.state === "recording" && s("recording", e, { elapsedMs: Date.now() - m.startedAt });
			}, 1e3), m.timer = setTimeout(() => {
				if (o === m && p.state !== "inactive") try {
					p.stop();
				} catch {
					u(m);
				}
			}, _.maxRecordingSeconds * 1e3), s("recording", e, { elapsedMs: 0 }), !0;
		} catch (t) {
			return w(f), d !== r || i ? !1 : (o = null, s("idle"), c(ne(t, e)));
		}
	}
	async function f() {
		let e = "screenshot";
		if (!l("screen")) return !1;
		let n = ++r;
		s("requesting", e);
		let a, u;
		try {
			if (a = await globalThis.navigator.mediaDevices.getDisplayMedia({
				video: !0,
				audio: !1
			}), i || n !== r) return w(a), !1;
			let c = {
				generation: n,
				kind: e,
				stream: a,
				timer: null,
				ticker: null,
				abort: new AbortController(),
				discard: !1
			};
			if (o = c, s("processing", e), u = globalThis.document.createElement("video"), u.muted = !0, u.playsInline = !0, u.srcObject = a, await u.play(), await E(u, c.abort.signal), await new Promise((e) => {
				typeof globalThis.requestAnimationFrame == "function" ? globalThis.requestAnimationFrame(e) : setTimeout(e, 0);
			}), i || n !== r) return !1;
			let l = globalThis.document.createElement("canvas");
			l.width = u.videoWidth, l.height = u.videoHeight;
			let d = l.getContext("2d");
			if (!d) throw x("The screenshot canvas is unavailable.", "SCREENSHOT_UNAVAILABLE");
			d.drawImage(u, 0, 0, l.width, l.height);
			let f = await D(l);
			if (i || n !== r) return !1;
			let p = new File([f], T(e, "image/png"), {
				type: "image/png",
				lastModified: Date.now()
			});
			return te(p), C(t, p, Object.freeze({
				kind: e,
				durationMs: 0
			})), !0;
		} catch (e) {
			return n !== r || i ? !1 : c(ne(e, "screen"));
		} finally {
			u && (u.pause(), u.srcObject = null), w(a), o?.generation === n && (o = null), !i && n === r && s("idle");
		}
	}
	function p() {
		let e = o;
		if (!e) return !1;
		if (e.recorder && e.recorder.state !== "inactive") {
			clearInterval(e.ticker), s("processing", e.kind, { elapsedMs: Date.now() - e.startedAt });
			try {
				e.recorder.stop();
			} catch (t) {
				c(t), u(e);
			}
			return !0;
		}
		return r += 1, u(e), !0;
	}
	function m() {
		r += 1;
		let e = o;
		if (o = null, e) {
			if (e.discard = !0, clearTimeout(e.timer), clearInterval(e.ticker), e.abort?.abort(), e.recorder?.state !== "inactive") try {
				e.recorder.stop();
			} catch {}
			w(e.stream);
		}
		i || s("idle");
	}
	function h() {
		i || (m(), i = !0, a = "disposed");
	}
	return s("idle"), Object.freeze({
		startVoice: () => d("voice", () => globalThis.navigator.mediaDevices.getUserMedia({ audio: !0 })),
		startVideo: () => d("video", () => globalThis.navigator.mediaDevices.getUserMedia({
			video: !0,
			audio: !0
		})),
		startScreenRecording: () => d("screen", () => globalThis.navigator.mediaDevices.getDisplayMedia({
			video: !0,
			audio: !0
		})),
		captureScreenshot: f,
		stop: p,
		cancel: m,
		dispose: h
	});
}
//#endregion
//#region src/widget/elementPicker.js
var ae = "[data-feedback-private],[data-private],input,textarea,select,[contenteditable]:not([contenteditable=\"false\"])", O = 80, oe = 12;
function k(e) {
	return String(e || "").replace(/\s+/g, " ").trim().slice(0, O);
}
function se(e) {
	return !!(e && e.nodeType === 1);
}
function A(e) {
	return !!e.closest?.(ae);
}
function ce(e) {
	return globalThis.CSS?.escape ? globalThis.CSS.escape(e) : String(e).replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (e) => `\\${e.codePointAt(0).toString(16)} `);
}
function j(e, t) {
	try {
		return e.querySelectorAll(t).length === 1;
	} catch {
		return !1;
	}
}
function M(e, t) {
	let n = [], r = e;
	for (let e = 0; r && e < oe; e += 1) {
		let e = r.tagName.toLowerCase(), i = 1, a = r.previousElementSibling;
		for (; a;) a.tagName === r.tagName && (i += 1), a = a.previousElementSibling;
		n.unshift(`${e}:nth-of-type(${i})`);
		let o = n.join(" > ");
		if (j(t, o)) return o;
		r = r.parentElement;
	}
	return n.join(" > ");
}
function N(e, t, n) {
	if (!n && e.id && e.id.length <= 120) {
		let n = `#${ce(e.id)}`;
		if (j(t, n)) return n;
	}
	return M(e, t);
}
function le(e, t) {
	let n = t.defaultView.NodeFilter, r = t.createTreeWalker(e, n.SHOW_TEXT, { acceptNode(e) {
		return e.parentElement?.closest(ae) ? n.FILTER_REJECT : n.FILTER_ACCEPT;
	} }), i = "";
	for (; r.nextNode() && i.length <= O;) i += ` ${r.currentNode.nodeValue}`;
	return k(i);
}
function P(e, t) {
	let n = k(e.getAttribute("aria-label"));
	if (n) return n;
	let r = e.getAttribute("aria-labelledby");
	if (r) {
		let e = r.split(/\s+/).map((e) => t.getElementById(e)).filter((e) => e && !A(e)).map((e) => le(e, t)).join(" ");
		if (k(e)) return k(e);
	}
	return e.tagName.toLowerCase() === "img" ? k(e.alt) : le(e, t);
}
function F(e) {
	try {
		let t = new URL(e.defaultView.location.href);
		return `${t.origin}${t.pathname}`;
	} catch {
		return "";
	}
}
function ue(e, t) {
	return e?.closest?.("[data-feedback-picker-ui]") ? !0 : !e || !t ? !1 : (Array.isArray(t) ? t : [t]).some((t) => typeof t == "function" ? t(e) === !0 : typeof t == "string" ? !!e.closest?.(t) : !(!t || typeof t.contains != "function" || t !== e && !t.contains(e)));
}
function I(e, t, n) {
	let r = typeof e.composedPath == "function" ? e.composedPath() : [], i = se(e.target) ? e.target : r.find(se);
	if (i) return ue(i, n) ? null : i;
	let a = e.touches?.[0] || e.changedTouches?.[0] || e, o = Number.isFinite(a.clientX) && Number.isFinite(a.clientY) ? t.elementFromPoint(a.clientX, a.clientY) : null;
	return o && !ue(o, n) ? o : null;
}
function de(e, t) {
	let n = A(e), r = e.getBoundingClientRect(), i = t.defaultView;
	return Object.freeze({
		selector: N(e, t, n),
		tagName: e.tagName.toLowerCase(),
		label: n ? "" : P(e, t),
		rect: Object.freeze({
			x: r.x,
			y: r.y,
			width: r.width,
			height: r.height
		}),
		viewport: Object.freeze({
			width: i.innerWidth,
			height: i.innerHeight
		}),
		pageUrl: F(t)
	});
}
function fe({ document: e = globalThis.document, onPick: t, onCancel: n, exclude: r } = {}) {
	if (!e?.documentElement || typeof e.elementFromPoint != "function") throw Error("Element picking requires a browser document.");
	let i = e.defaultView, a = e.activeElement, o = e.createElement("div");
	o.setAttribute("aria-hidden", "true"), o.dataset.feedbackPickerOverlay = "", Object.assign(o.style, {
		position: "fixed",
		zIndex: "2147483646",
		pointerEvents: "none",
		border: "2px solid #14b8a6",
		background: "rgba(20, 184, 166, 0.10)",
		borderRadius: "4px",
		boxSizing: "border-box",
		display: "none"
	}), e.documentElement.append(o);
	let s = e.createElement("div");
	s.dataset.feedbackPickerUi = "", s.dataset.feedbackPrivate = "", s.setAttribute("role", "status"), Object.assign(s.style, {
		position: "fixed",
		zIndex: "2147483647",
		bottom: "24px",
		left: "50%",
		transform: "translateX(-50%)",
		width: "max-content",
		maxWidth: "calc(100vw - 24px)",
		boxSizing: "border-box",
		display: "flex",
		alignItems: "center",
		gap: "16px",
		borderRadius: "12px",
		padding: "12px 16px",
		background: "#18332F",
		color: "#FFFFFF",
		font: "13px/1.5 system-ui, sans-serif",
		boxShadow: "0 8px 32px #102b2833"
	});
	let c = e.createElement("span");
	c.textContent = "Select an element to tag. Press Escape to cancel.";
	let l = e.createElement("button");
	l.type = "button", l.textContent = "Cancel tagging", Object.assign(l.style, {
		font: "inherit",
		color: "inherit",
		cursor: "pointer",
		padding: "8px 12px",
		border: "1px solid #ffffff55",
		borderRadius: "8px",
		background: "transparent"
	}), l.addEventListener("click", _), s.append(c, l), e.body.append(s);
	let u = !0, d = null;
	function f() {
		if (typeof a?.focus == "function" && a.isConnected) try {
			a.focus({ preventScroll: !0 });
		} catch {
			a.focus();
		}
	}
	function p() {
		return u ? (u = !1, e.removeEventListener("pointermove", h, !0), e.removeEventListener("touchstart", h, !0), e.removeEventListener("touchmove", h, !0), e.removeEventListener("click", ee, !0), e.removeEventListener("keydown", v, !0), i.removeEventListener("scroll", g, !0), i.removeEventListener("resize", g), o.remove(), s.remove(), d = null, f(), !0) : !1;
	}
	function m(e) {
		if (d = e, !e) {
			o.style.display = "none";
			return;
		}
		let t = e.getBoundingClientRect();
		Object.assign(o.style, {
			display: "block",
			left: `${t.left}px`,
			top: `${t.top}px`,
			width: `${t.width}px`,
			height: `${t.height}px`
		});
	}
	function h(t) {
		m(I(t, e, r));
	}
	function g() {
		d?.isConnected ? m(d) : m(null);
	}
	function ee(n) {
		let i = I(n, e, r);
		if (!i) return;
		n.preventDefault(), n.stopImmediatePropagation();
		let a = de(i, e);
		p(), typeof t == "function" && t(a);
	}
	function _() {
		p() && typeof n == "function" && n();
	}
	function v(e) {
		e.key === "Escape" && (e.preventDefault(), e.stopImmediatePropagation(), _());
	}
	return e.addEventListener("pointermove", h, !0), e.addEventListener("touchstart", h, {
		capture: !0,
		passive: !0
	}), e.addEventListener("touchmove", h, {
		capture: !0,
		passive: !0
	}), e.addEventListener("click", ee, !0), e.addEventListener("keydown", v, !0), i.addEventListener("scroll", g, !0), i.addEventListener("resize", g), _;
}
//#endregion
//#region src/widget/user.js
var pe = /* @__PURE__ */ new Set([
	"id",
	"email",
	"name",
	"company",
	"attributes"
]), me = /* @__PURE__ */ new Set(["id", "name"]), he = /* @__PURE__ */ new Set([
	"__proto__",
	"prototype",
	"constructor"
]);
function ge(e) {
	if (!e || typeof e != "object" || Array.isArray(e)) return !1;
	let t = Object.getPrototypeOf(e);
	return t === Object.prototype || t === null;
}
function _e(e, t) {
	if (!ge(e)) throw Error(`${t} must be a plain object.`);
}
function ve(e, t, n) {
	for (let r of Object.keys(e)) if (he.has(r) || !t.has(r)) throw Error(`${n} contains an unsupported field: ${r}.`);
}
function L(e, t, n) {
	if (typeof e != "string") throw Error(`${t} must be a string.`);
	let r = e.trim();
	if (!r) throw Error(`${t} cannot be empty.`);
	if (r.length > n) throw Error(`${t} must be ${n} characters or fewer.`);
	return r;
}
function ye(e) {
	let t = L(e, "User email", 254);
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw Error("User email must be a valid email address.");
	return t;
}
function be(e) {
	if (!e || e.length > 64) throw Error("User attribute keys must be 1 to 64 characters.");
	if (he.has(e)) throw Error(`User attributes contain an unsupported key: ${e}.`);
	return e;
}
function xe(e, t) {
	if (e === null || typeof e == "boolean") return e;
	if (typeof e == "number") {
		if (!Number.isFinite(e)) throw Error(`User attribute ${t} must be a finite number.`);
		return e;
	}
	if (typeof e == "string") {
		if (e.length > 500) throw Error(`User attribute ${t} must be 500 characters or fewer.`);
		return e;
	}
	throw Error(`User attribute ${t} must be a string, number, boolean, or null.`);
}
function R(e, { patch: t = !1 } = {}) {
	if (t && e === null) return null;
	_e(e, "User company"), ve(e, me, "User company");
	let n = {};
	for (let [r, i] of [["id", 128], ["name", 100]]) if (Object.hasOwn(e, r)) {
		if (z(e[r])) {
			t && (n[r] = null);
			continue;
		}
		n[r] = L(e[r], `Company ${r}`, i);
	}
	return n;
}
function Se(e, { patch: t = !1 } = {}) {
	if (t && e === null) return null;
	_e(e, "User attributes");
	let n = Object.entries(e);
	if (n.length > 30) throw Error("Use at most 30 user attributes.");
	let r = {};
	for (let [e, i] of n) be(e), r[e] = t && i === null ? null : xe(i, e);
	return r;
}
var z = (e) => e == null || typeof e == "string" && !e.trim();
function Ce(e, { patch: t = !1 } = {}) {
	_e(e, t ? "User update" : "User"), ve(e, pe, t ? "User update" : "User");
	let n = {};
	for (let [r, i] of [["id", 128], ["name", 80]]) if (Object.hasOwn(e, r)) {
		if (z(e[r])) {
			t && (n[r] = null);
			continue;
		}
		n[r] = L(e[r], `User ${r}`, i);
	}
	if (Object.hasOwn(e, "email")) {
		if (z(e.email)) t && (n.email = null);
		else try {
			n.email = ye(e.email);
		} catch (e) {
			console.warn("[Feedback Studio] Ignoring user email:", e.message), t && (n.email = null);
		}
	}
	return Object.hasOwn(e, "company") && (e.company != null || t) && (n.company = R(e.company, { patch: t })), Object.hasOwn(e, "attributes") && (n.attributes = Se(e.attributes, { patch: t })), n;
}
function B(e) {
	return e ? (e.company && Object.freeze(e.company), e.attributes && Object.freeze(e.attributes), Object.freeze(e)) : null;
}
function we(e) {
	if (e == null) return null;
	let t = Ce(e);
	return Object.keys(t).length ? B(t) : null;
}
function Te(e) {
	try {
		return we(e);
	} catch (e) {
		return console.warn("[Feedback Studio] User details were ignored:", e.message), null;
	}
}
function Ee(e) {
	let t = we(e);
	return t ? t.id ? `id:${t.id}` : t.email ? `email:${t.email.toLowerCase()}` : null : null;
}
function De(e, t) {
	let n = we(e);
	if (t === null) return null;
	let r = Ce(t, { patch: !0 }), i = Object.hasOwn(r, "id") && (r.id ?? null) !== (n?.id ?? null), a = !n?.id && Object.hasOwn(r, "email") && (r.email?.toLowerCase() ?? null) !== (n?.email?.toLowerCase() ?? null), o = i || a ? {} : { ...n || {} };
	for (let e of [
		"id",
		"email",
		"name"
	]) Object.hasOwn(r, e) && (r[e] === null ? delete o[e] : o[e] = r[e]);
	if (Object.hasOwn(r, "company")) {
		if (r.company === null) delete o.company;
		else {
			let e = { ...o.company || {} };
			for (let t of me) Object.hasOwn(r.company, t) && (r.company[t] === null ? delete e[t] : e[t] = r.company[t]);
			Object.keys(e).length ? o.company = e : delete o.company;
		}
	}
	if (Object.hasOwn(r, "attributes")) {
		if (r.attributes === null) delete o.attributes;
		else {
			let e = { ...o.attributes || {} };
			for (let [t, n] of Object.entries(r.attributes)) n === null ? delete e[t] : e[t] = n;
			if (Object.keys(e).length > 30) throw Error("Use at most 30 user attributes.");
			Object.keys(e).length ? o.attributes = e : delete o.attributes;
		}
	}
	return B(o);
}
//#endregion
//#region src/widget/mount.js
var Oe = 4096, ke = 16777216, Ae = "\n  :host {\n    all: initial;\n    font-family: var(--font);\n    font-size: 14px;\n    line-height: 1.5;\n    color: var(--text);\n    position: relative;\n    z-index: 2147483000;\n  }\n  * { box-sizing: border-box; }\n  button, input, textarea, select { font: inherit; outline-offset: 3px; }\n  button { min-height: 40px; border: 0; cursor: pointer; }\n  button:disabled { opacity: .5; cursor: not-allowed; }\n  button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {\n    outline: 3px solid var(--accent);\n  }\n  button, textarea, input, select { border-radius: 10px; }\n  input, textarea, select {\n    width: 100%;\n    padding: 10px 12px;\n    background: var(--surface);\n    color: var(--text);\n    border: 1px solid var(--line);\n  }\n  textarea { resize: vertical; min-height: 112px; }\n  label { display: grid; gap: 6px; font-size: 12px; font-weight: 600; margin-bottom: 14px; }\n  label span { color: var(--muted); font-weight: 400; }\n  a { color: inherit; }\n  p, h2 { margin: 0; }\n  .launcher {\n    position: fixed;\n    bottom: var(--launcher-edge-y);\n    right: var(--launcher-edge-x);\n    display: grid;\n    place-items: center;\n    width: 56px;\n    height: 56px;\n    min-width: 56px;\n    min-height: 56px;\n    padding: 0;\n    background: var(--accent);\n    color: var(--on-accent);\n    box-shadow: 0 4px 18px #102b2826;\n    border-radius: 50%;\n  }\n  .launcher svg { width: 24px; height: 24px; }\n  .launcher img { width: 34px; height: 34px; object-fit: contain; border-radius: 7px; }\n  .launcher.is-pill { display: inline-flex; align-items: center; gap: 8px; width: auto; height: 50px; min-height: 50px; padding: 0 20px 0 16px; border-radius: 999px; font-weight: 650; font-size: 14px; white-space: nowrap; }\n  .launcher.is-pill svg, .launcher.is-pill img { width: 22px; height: 22px; }\n  .panel {\n    position: fixed;\n    right: var(--panel-edge-x);\n    bottom: var(--panel-edge-y);\n    width: min(var(--panel-width, 380px), max(0px, calc(100vw - var(--panel-edge-x) - var(--panel-opposite-edge-x))));\n    max-width: max(0px, calc(100vw - var(--panel-edge-x) - var(--panel-opposite-edge-x)));\n    max-height: min(720px, var(--panel-max-height), max(0px, calc(100dvh - var(--panel-edge-y) - var(--panel-top-gutter))));\n    display: flex;\n    flex-direction: column;\n    background: var(--surface);\n    color: var(--text);\n    border: 1px solid var(--line);\n    border-radius: var(--radius);\n    box-shadow: 0 18px 60px #122e2a2b;\n    overflow: hidden;\n  }\n  .panel[hidden], .launcher[hidden], [hidden] { display: none !important; }\n  .head { padding: 24px 22px 20px; background: var(--accent); color: var(--on-accent); position: relative; }\n  .head img { width: 38px; height: 38px; object-fit: contain; margin-bottom: 16px; border-radius: 8px; }\n  .head h2 { font-size: 21px; line-height: 1.25; letter-spacing: -.5px; padding-right: 28px; }\n  .head p { font-size: 12px; margin-top: 9px; opacity: .9; line-height: 1.6; }\n  .head.is-plain { background: var(--surface); color: var(--text); border-bottom: 1px solid var(--line); }\n  .head.is-plain p { color: var(--muted); opacity: 1; }\n  .close { position: absolute; right: 12px; top: 12px; width: 36px; min-height: 36px; background: transparent; color: inherit; font-size: 24px; }\n  .body { padding: 20px 22px; overflow: auto; overscroll-behavior: contain; }\n  .types { display: flex; gap: 6px; margin-bottom: 18px; }\n  .types button { font-size: 11px; flex: 1; border: 1px solid var(--line); background: var(--surface); color: var(--muted); padding: 7px; }\n  .types button[aria-pressed=true] { border-color: var(--accent); color: var(--accent); background: var(--soft); }\n  .tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 8px 0 15px; }\n  .tools button {\n    background: var(--soft);\n    color: var(--text);\n    border: 1px solid var(--line);\n    padding: 9px 4px;\n    font-size: 11px;\n    display: grid;\n    justify-items: center;\n    gap: 4px;\n  }\n  .tools svg { width: 18px; height: 18px; stroke-width: 1.8; }\n  .hint { font-size: 11px; color: var(--muted); line-height: 1.6; margin: 8px 0; }\n  .user-summary { margin: -3px 0 14px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--soft); color: var(--muted); font-size: 11px; }\n  .user-summary summary { cursor: pointer; color: var(--text); overflow-wrap: anywhere; }\n  .user-summary dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 9px; margin: 9px 0 0; }\n  .user-summary dt { font-weight: 650; color: var(--muted); }\n  .user-summary dd { margin: 0; overflow-wrap: anywhere; }\n  .send { background: var(--accent); color: var(--on-accent); font-weight: 650; width: 100%; padding: 12px; min-height: 46px; }\n  .status { font-size: 12px; line-height: 1.5; margin: 12px 0; color: var(--text); overflow-wrap: anywhere; }\n  .status.error { color: #c1343d; }\n  .brand { font-size: 10px; color: var(--muted); text-align: center; margin-top: 12px; }\n  .attachments { display: grid; gap: 10px; margin: 12px 0; }\n  .attachment { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--soft); }\n  .attachment img, .attachment video { display: block; width: 100%; max-height: 180px; object-fit: contain; background: #1026220a; }\n  .attachment audio { width: 100%; height: 40px; }\n  .attachment-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 11px; }\n  .attachment-row span { flex: 1; overflow-wrap: anywhere; }\n  .attachment button { background: transparent; color: var(--muted); font-size: 11px; padding: 5px; min-height: 32px; }\n  .recording { padding: 13px; border: 1px solid #df8d87; border-radius: 10px; background: #ffefec; color: #882b29; font-size: 12px; margin-bottom: 14px; }\n  .recording button { padding: 6px 12px; background: #fff; color: #882b29; margin: 8px 6px 0 0; }\n  .tag { font-size: 11px; padding: 10px; border: 1px solid var(--line); background: var(--soft); border-radius: 10px; overflow-wrap: anywhere; margin-bottom: 12px; }\n  .tag button { background: none; color: var(--muted); min-height: 28px; }\n  .back { position: absolute; left: 12px; top: 12px; width: 36px; min-height: 36px; background: transparent; color: inherit; font-size: 20px; }\n  .head.is-compact { display: flex; align-items: center; gap: 10px; padding: 14px 52px 14px 54px; min-height: 64px; }\n  .head.is-compact img { width: 28px; height: 28px; margin: 0; }\n  .head.is-compact h2 { font-size: 16px; padding: 0; }\n  .head.is-compact p { display: none; }\n  .home { display: grid; gap: 10px; }\n  .home-card { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--text); text-align: left; box-shadow: 0 1px 2px #0000000a; }\n  .home-card:hover { border-color: var(--accent); }\n  .home-card .icon { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--soft); color: var(--accent); }\n  .home-card .icon svg { width: 18px; height: 18px; }\n  .home-card strong { display: block; font-size: 14px; }\n  .home-card small { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; line-height: 1.4; }\n  .home-card .chevron { margin-left: auto; color: var(--muted); font-size: 18px; }\n  .home-links { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }\n  .home-links a { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; color: var(--text); font-size: 13px; text-decoration: none; }\n  .home-links a + a { border-top: 1px solid var(--line); }\n  .home-links a:hover { background: var(--soft); }\n  .home-links a span:last-child { color: var(--accent); }\n  .ask { display: flex; flex-direction: column; gap: 10px; min-height: 300px; }\n  .log { display: grid; gap: 10px; align-content: start; flex: 1; }\n  .bubble { max-width: 88%; padding: 10px 13px; border-radius: 14px; font-size: 13px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }\n  .bubble.bot { justify-self: start; background: var(--soft); color: var(--text); border-bottom-left-radius: 4px; }\n  .bubble.me { justify-self: end; background: var(--accent); color: var(--on-accent); border-bottom-right-radius: 4px; }\n  .bubble.error { background: #fdeeee; color: #8a2a2f; }\n  .bubble .sources { display: grid; gap: 4px; margin-top: 8px; font-size: 12px; white-space: normal; }\n  .bubble .sources a { color: var(--accent); }\n  .meta { justify-self: start; margin-top: -4px; color: var(--muted); font-size: 11px; }\n  .typing { justify-self: start; padding: 10px 13px; border-radius: 14px; background: var(--soft); color: var(--muted); font-size: 13px; }\n  .handoff { justify-self: start; min-height: 32px; padding: 6px 12px; border: 1px solid var(--line); background: var(--surface); color: var(--text); font-size: 12px; }\n  .composer { display: flex; align-items: flex-end; gap: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }\n  .composer:focus-within { border-color: var(--accent); }\n  .composer textarea { min-height: 40px; max-height: 120px; padding: 8px; border: 0; resize: none; background: transparent; }\n  .composer textarea:focus-visible { outline: none; }\n  .composer button { flex: none; width: 38px; min-height: 38px; border-radius: 50%; background: var(--accent); color: var(--on-accent); font-size: 16px; }\n  .success { text-align: center; padding: 24px 8px; display: grid; gap: 16px; }\n  .success strong { font-size: 19px; }\n  .secondary { padding: 9px 14px; background: var(--soft); color: var(--text); border: 1px solid var(--line); }\n  .consent { font-size: 11px; color: var(--muted); font-weight: 400; display: flex; align-items: start; gap: 8px; }\n  .consent input { width: 16px; height: 16px; margin: 2px 0; accent-color: var(--accent); flex-shrink: 0; }\n  .redaction {\n    width: min(760px, calc(100vw - 32px));\n    max-width: 760px;\n    max-height: calc(100dvh - 32px);\n    margin: auto;\n    padding: 20px;\n    color: var(--text);\n    background: var(--surface);\n    border: 1px solid var(--line);\n    border-radius: 16px;\n    box-shadow: 0 24px 80px #102b2852;\n    overflow: auto;\n  }\n  .redaction::backdrop { background: #0b1f1c80; }\n  .redaction h2 { font-size: 18px; line-height: 1.3; }\n  .redaction canvas {\n    display: block;\n    width: auto;\n    height: auto;\n    max-width: 100%;\n    max-height: min(60vh, 620px);\n    margin: 16px auto;\n    touch-action: none;\n    cursor: crosshair;\n    border: 1px solid var(--line);\n  }\n  .redaction-actions { display: flex; justify-content: flex-end; gap: 8px; }\n  :host([data-left]) .launcher { left: var(--launcher-edge-x); right: auto; }\n  :host([data-left]) .panel { left: var(--panel-edge-x); right: auto; }\n  :host([data-inline]) { position: relative; display: block; z-index: 1; width: 100%; height: 100%; }\n  :host([data-inline]) .panel {\n    position: absolute;\n    bottom: var(--panel-edge-y);\n    max-height: min(var(--panel-max-height), max(0px, calc(100% - var(--panel-edge-y) - var(--panel-top-gutter))));\n    width: min(var(--panel-width, 370px), max(0px, calc(100% - var(--panel-edge-x) - var(--panel-opposite-edge-x))));\n    right: var(--panel-edge-x);\n    max-width: max(0px, calc(100% - var(--panel-edge-x) - var(--panel-opposite-edge-x)));\n  }\n  :host([data-inline]) .launcher { position: absolute; bottom: var(--launcher-edge-y); right: var(--launcher-edge-x); }\n  :host([data-inline][data-left]) .panel { left: var(--panel-edge-x); right: auto; }\n  :host([data-inline][data-left]) .launcher { left: var(--launcher-edge-x); right: auto; }\n  @media (max-width: 440px) {\n    .body { padding: 16px; }\n    .head { padding: 20px; }\n    input, textarea, select { font-size: 16px; }\n    .redaction { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); padding: 14px; }\n  }\n  :host([data-mobile]) .body { padding: 16px; }\n  :host([data-mobile]) .head { padding: 20px; }\n  :host([data-mobile]) input, :host([data-mobile]) textarea, :host([data-mobile]) select { font-size: 16px; }\n  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }\n", je = Object.freeze({
	launcher: ["<path d=\"M5 4h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z\"/>", "<path d=\"M7 10h10M7 14h6\"/>"],
	lightbulb: ["<path d=\"M9 18h6M10 21h4\"/>", "<path d=\"M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z\"/>"],
	help: ["<circle cx=\"12\" cy=\"12\" r=\"9\"/>", "<path d=\"M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9M12 17h.01\"/>"],
	megaphone: ["<path d=\"M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1Z\"/>", "<path d=\"M17 8.5a5 5 0 0 1 0 7M8 14l1 5h2.5\"/>"],
	heart: ["<path d=\"M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z\"/>"],
	close: ["<path d=\"m7 7 10 10M17 7 7 17\"/>"],
	ask: ["<path d=\"M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4Z\"/>", "<path d=\"M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z\"/>"],
	image: [
		"<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/>",
		"<path d=\"m3 16 5-5 4 4 2-2 7 7\"/>",
		"<circle cx=\"15.5\" cy=\"8.5\" r=\"1.5\"/>"
	],
	voice: ["<rect x=\"9\" y=\"3\" width=\"6\" height=\"11\" rx=\"3\"/>", "<path d=\"M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6\"/>"],
	video: ["<rect x=\"3\" y=\"5\" width=\"13\" height=\"14\" rx=\"2\"/>", "<path d=\"m16 10 5-3v10l-5-3\"/>"],
	screen: ["<rect x=\"3\" y=\"4\" width=\"18\" height=\"14\" rx=\"2\"/>", "<path d=\"M8 21h8M12 18v3\"/>"],
	screenshot: ["<path d=\"M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3\"/>", "<circle cx=\"12\" cy=\"12\" r=\"3\"/>"],
	element: ["<path d=\"m5 3 6.5 16 2.2-6.3L20 10.5 5 3Z\"/>", "<path d=\"m14 14 4 4\"/>"]
});
function V(e, t, n) {
	let r = document.createElement(e);
	return t && (r.textContent = t), n && (r.className = n), r;
}
function H(e, t, n) {
	let r = V("button", e, n);
	return r.type = "button", r.addEventListener("click", t), r;
}
function Me(e) {
	let t = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	return t.setAttribute("viewBox", "0 0 24 24"), t.setAttribute("fill", "none"), t.setAttribute("stroke", "currentColor"), t.setAttribute("stroke-linecap", "round"), t.setAttribute("stroke-linejoin", "round"), t.setAttribute("aria-hidden", "true"), t.innerHTML = je[e].join(""), t;
}
var Ne = () => globalThis.crypto?.randomUUID?.() || `feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function Pe(e, t) {
	let n = Math.min(1, Oe / e, Oe / t), r = Math.min(1, Math.sqrt(ke / (e * t))), i = Math.min(n, r);
	return {
		width: Math.max(1, Math.round(e * i)),
		height: Math.max(1, Math.round(t * i))
	};
}
function Fe({ config: e = {}, user: t = null, boardId: r = "", widgetId: i = "", target: a = document.body, onSubmit: s, onAsk: c, onOpen: l, inline: u = !1, previewViewportWidth: p = null } = {}) {
	if (p !== null && (!Number.isInteger(p) || p < 1 || p > 1e4)) throw Error("Widget preview viewport width must be a whole number between 1 and 10000.");
	if (p !== null && !u) throw Error("Widget preview viewport width is only available for inline previews.");
	let m = d(e), h = Te(t), v = !1, y = !1, b = !1, x = null, S = "", C = null, w = null, ne = null, re = !1, T = null, E = "feature", D = 0, ae = !1, O = null, oe = s, k = c, se = !1, A = [], ce = [], j = [], M = V("div");
	M.dataset.feedbackWidget = "", M.dataset.feedbackPrivate = "", u && (M.dataset.inline = "");
	let N = M.attachShadow({ mode: "open" }), le = V("style");
	le.textContent = Ae, N.append(le);
	let P = H("", () => I.hidden ? wt() : Tt(), "launcher"), F = V("img");
	F.alt = "", F.referrerPolicy = "no-referrer";
	let ue = "";
	F.addEventListener("error", () => {
		ue = F.getAttribute("src") || "", Et();
	}), F.addEventListener("load", () => {
		ue === m.logoUrl && (ue = "", Et());
	}), P.append(Me("launcher")), P.setAttribute("aria-haspopup", "dialog"), P.setAttribute("aria-expanded", "false");
	let I = V("section", "", "panel");
	I.hidden = !0, I.setAttribute("role", "dialog"), I.setAttribute("aria-label", "Feedback and help"), I.setAttribute("aria-modal", "false"), I.tabIndex = -1;
	let de = V("header", "", "head"), pe = V("img");
	pe.alt = "", pe.referrerPolicy = "no-referrer";
	let me = V("h2"), he = V("p"), ge = H("×", Tt, "close");
	ge.setAttribute("aria-label", "Close feedback");
	let _e = H("←", () => nt("home"), "back");
	_e.setAttribute("aria-label", "Back"), de.append(_e, pe, me, he, ge);
	let ve = V("div", "", "body"), L = V("form"), ye = V("div", "", "types");
	ye.setAttribute("aria-label", "Feedback type");
	for (let [e, t] of [
		["feature", "Idea"],
		["bug", "Problem"],
		["question", "Question"],
		["praise", "Praise"]
	]) {
		let n = H(t, () => {
			E = e;
			for (let [t, n] of j) n.setAttribute("aria-pressed", String(t === e));
		});
		n.setAttribute("aria-pressed", String(E === e)), j.push([e, n]), ye.append(n);
	}
	function be(e, t, n, r) {
		let i = V("label", e), a = V(t);
		return a.maxLength = n, a.placeholder = r, i.append(a), [i, a];
	}
	let [xe, R] = be("A short title", "input", 180, "What would you like us to know?");
	R.required = !0;
	let [Se, z] = be("Your feedback", "textarea", 8e3, "Tell us what happened, or what could be better.");
	z.required = !0;
	let [Ce, B] = be("Email", "input", 254, "you@example.com");
	B.type = "email", B.autocomplete = "email", B.addEventListener("input", () => {
		ae = !0;
	});
	let we = V("details", "", "user-summary"), Oe = V("summary"), ke = V("dl");
	we.append(Oe, ke);
	let je = V("div", "", "tools"), Fe = V("div", "", "recording");
	Fe.hidden = !0;
	let Le = V("div", "", "attachments"), U = V("div", "", "tag");
	U.hidden = !0;
	let Re = V("p", "Review your attachments before sending. Recordings are limited to 2 minutes.", "hint"), W = V("p", "", "status");
	W.setAttribute("role", "status"), W.setAttribute("aria-live", "polite");
	let ze = V("label", "", "consent"), Be = V("input");
	Be.type = "checkbox", Be.required = !0;
	let Ve = V("span");
	ze.append(Be, Ve);
	let He = V("button", "", "send");
	He.type = "submit";
	let Ue = V("p", "Feedback Studio by Goalmatic", "brand"), G = V("input");
	G.type = "file", G.multiple = !0, G.accept = "image/png,image/jpeg,image/webp", G.hidden = !0, L.append(ye, xe, we, Se, Ce, je, Fe, Le, U, Re, ze, W, He, Ue, G);
	let We = V("div", "", "home");
	function Ge(e, t, n, r) {
		let i = H("", r, "home-card"), a = V("span", "", "icon");
		a.append(Me(e));
		let o = V("span");
		return o.append(V("strong", t), V("small", n)), i.append(a, o, V("span", "›", "chevron")), i;
	}
	let Ke = Ge("ask", "Ask a question", "", () => nt("ask")), qe = Ge("launcher", "Share feedback", "An idea, a problem, or something you love", () => nt("feedback")), Je = V("nav", "", "home-links");
	Je.setAttribute("aria-label", "Help links");
	let Ye = V("p", "Feedback Studio by Goalmatic", "brand");
	We.append(Ke, qe, Je, Ye);
	let Xe = V("div", "", "ask"), K = V("div", "", "log");
	K.setAttribute("role", "log"), K.setAttribute("aria-live", "polite");
	let Ze = V("form", "", "composer"), q = V("textarea");
	q.rows = 1, q.maxLength = 1e3, q.placeholder = "Ask a question…", q.setAttribute("aria-label", "Your question");
	let Qe = V("button", "↑");
	Qe.type = "submit", Qe.setAttribute("aria-label", "Send question"), Ze.append(q, Qe), Xe.append(K, Ze), ve.append(We, Xe, L), I.append(de, ve), N.append(I, P), a.append(M);
	let J = "feedback", $e = !1, Y = [], et = () => m.aiEnabled || m.links.length > 0;
	function tt() {
		let e = J !== "home" && et();
		de.classList.toggle("is-compact", e), _e.hidden = !e;
		let t = h?.name ? h.name.split(/\s+/)[0] : "";
		me.textContent = J === "ask" ? m.aiName : J === "feedback" && et() ? "Share feedback" : J === "home" && t ? `Hi ${t} 👋` : m.title;
	}
	function nt(e, { focus: t = !0 } = {}) {
		J = et() ? e : "feedback", We.hidden = J !== "home", Xe.hidden = J !== "ask", L.hidden = J !== "feedback" || !!O, O && (O.hidden = J !== "feedback"), tt(), J === "ask" && !Y.length && rt("bot", m.aiIntro), t && !I.hidden && (J === "ask" ? q.focus() : J === "feedback" && !O ? R.focus() : We.querySelector("button")?.focus());
	}
	function rt(e, t, n = []) {
		let r = V("div", t, `bubble ${e}`);
		if (n.length) {
			let e = V("div", "", "sources");
			for (let t of n) {
				let n = V("a", t.title);
				n.href = t.url, n.target = "_blank", n.rel = "noopener noreferrer", e.append(n);
			}
			r.append(e);
		}
		return K.append(r), e === "bot" && Y.push({
			role: "assistant",
			content: t
		}), r.scrollIntoView?.({ block: "end" }), r;
	}
	function it() {
		let e = Y.find((e) => e.role === "user")?.content || "";
		if (R.value = e.slice(0, 180), z.value = Y.map((e) => `${e.role === "user" ? "Me" : m.aiName}: ${e.content}`).join("\n\n").slice(0, 8e3), m.categories.includes("question")) {
			E = "question";
			for (let [e, t] of j) t.setAttribute("aria-pressed", String(e === E));
		}
		nt("feedback");
	}
	function at(e) {
		let t = typeof e?.answer == "string" ? e.answer.trim().slice(0, 4e3) : "";
		if (!t) throw Error("The assistant didn’t return an answer.");
		return {
			answer: t,
			sources: (Array.isArray(e.sources) ? e.sources : []).slice(0, 5).flatMap((e) => {
				try {
					return [{
						title: String(e.title || e.url).slice(0, 120),
						url: o(String(e.url || ""), { local: !0 })
					}];
				} catch {
					return [];
				}
			}),
			handoff: e.handoff === !0
		};
	}
	async function ot(e) {
		let t = {
			question: e,
			history: Y.slice(-10),
			user: h,
			context: bt(),
			...r ? { boardId: r } : {}
		};
		if (typeof k == "function") return at(await k(t));
		if (m.delivery !== "builtin" || !i || !m.endpoint) throw Error("Answers aren’t connected for this site yet.");
		let n = new URL(`/api/app-runtime/widgets/ask/${encodeURIComponent(i)}`, m.endpoint), a = new AbortController(), o = setTimeout(() => a.abort(), 3e4);
		try {
			let e = await fetch(n, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(t),
				credentials: "omit",
				referrerPolicy: "no-referrer",
				signal: a.signal
			});
			if (!e.ok) throw Error(e.status === 404 ? "Answers aren’t available for this site yet." : "The assistant couldn’t answer right now.");
			return at(await e.json());
		} catch (e) {
			throw e.name === "AbortError" ? /* @__PURE__ */ Error("The assistant took too long to answer.") : e instanceof TypeError ? /* @__PURE__ */ Error("The assistant couldn’t be reached.") : e;
		} finally {
			clearTimeout(o);
		}
	}
	async function st(e) {
		e?.preventDefault();
		let t = q.value.trim();
		if (!t || $e) return;
		let n = D;
		$e = !0, Qe.disabled = !0, q.value = "", K.querySelectorAll(".handoff").forEach((e) => e.remove()), rt("me", t), Y.push({
			role: "user",
			content: t
		});
		let r = V("div", `${m.aiName} is typing…`, "typing");
		K.append(r);
		try {
			let e = await ot(t);
			if (v || n !== D) return;
			r.remove(), rt("bot", e.answer, e.sources);
		} catch (e) {
			if (v || n !== D) return;
			r.remove(), rt("bot error", `${e.message} You can send your question to the team instead.`);
		} finally {
			n === D && ($e = !1, Qe.disabled = !1, v || K.append(H("Send this to the team", it, "handoff")));
		}
	}
	Ze.addEventListener("submit", st), q.addEventListener("keydown", (e) => {
		e.key === "Enter" && !e.shiftKey && !e.isComposing && st(e);
	});
	function ct() {
		Y.splice(0), K.replaceChildren(), $e = !1, Qe.disabled = !1, q.value = "";
	}
	function lt() {
		Ke.hidden = !m.aiEnabled, Ke.querySelector("small").textContent = "Get help or send your question to the team", Je.replaceChildren(), Je.hidden = !m.links.length;
		for (let e of m.links) {
			let t = V("a");
			t.href = e.url, t.target = "_blank", t.rel = "noopener noreferrer", t.append(V("span", e.label), V("span", "↗")), Je.append(t);
		}
		Ye.hidden = !m.showBranding, !et() && J !== "feedback" ? nt("feedback", { focus: !1 }) : tt();
	}
	function X(e) {
		v || (W.className = "status error", W.textContent = e?.message || String(e));
	}
	function ut() {
		if (we.hidden = !h, we.open = !1, ke.replaceChildren(), !h) return;
		let e = [h.name, h.email].filter(Boolean).join(" · ") || h.id || "Anonymous user details";
		Oe.textContent = `Sending as ${e}`;
		let t = [];
		h.id && t.push(["User ID", h.id]), h.name && t.push(["Name", h.name]), h.email && t.push(["Email", h.email]), h.company && t.push(["Company", [h.company.name, h.company.id].filter(Boolean).join(" · ")]);
		for (let [e, n] of Object.entries(h.attributes || {})) t.push([e, n === null ? "Not set" : String(n)]);
		for (let [e, n] of t) ke.append(V("dt", e), V("dd", n));
	}
	function dt({ force: e = !1 } = {}) {
		if (m.collectEmail === "off") {
			B.value = "", ae = !1;
			return;
		}
		(e || !ae) && (B.value = h?.email || "");
	}
	function Z() {
		let e = !!T;
		He.disabled = y || b || e;
		for (let [, t] of j) t.disabled = y || e;
		for (let t of [
			R,
			z,
			B,
			Be
		]) t.disabled = y || e;
		for (let [t, n] of ce) n.hidden = !m.capture[t], n.disabled = y || b || e || A.length >= _.maxFiles && t !== "element";
		for (let t of Le.querySelectorAll("button")) t.disabled = y || e;
		ge.disabled = y || e, He.textContent = y ? "Sending…" : m.submitText;
	}
	function ft(e) {
		if (b = !(!e || [
			"idle",
			"error",
			"stopped"
		].includes(e.status || e.state)), Fe.hidden = !b, Fe.replaceChildren(), b) {
			let t = e.status === "requesting" ? "Waiting for browser permission…" : `Recording ${Math.floor((e.elapsedMs || 0) / 1e3)}s / ${_.maxRecordingSeconds}s`;
			Fe.append(V("span", t), H("Stop", () => Q.stop()), H("Discard", () => Q.cancel()));
		}
		Z();
	}
	let Q = ie({
		onState: ft,
		onRecording: (e, t) => pt(e, t),
		onError: X
	});
	function pt(e, t = {}) {
		if (!v) try {
			te(e, A.map((e) => e.file)), A.push({
				id: Ne(),
				file: e,
				url: URL.createObjectURL(e),
				kind: t.kind || (e.type.startsWith("image/") ? "image" : e.type.startsWith("audio/") ? "voice" : "video"),
				durationMs: t.durationMs || 0
			}), _t(), W.textContent = "";
		} catch (e) {
			X(e);
		}
	}
	G.addEventListener("change", () => {
		for (let e of G.files || []) pt(e);
		G.value = "";
	});
	let mt = {
		image: () => G.click(),
		voice: () => Q.startVoice(),
		video: () => Q.startVideo(),
		screen: () => Q.startScreenRecording(),
		screenshot: () => Q.captureScreenshot(),
		element: () => {
			I.hidden = !0, P.hidden = !0, M.style.pointerEvents = "none", w = fe({
				exclude: (e) => M.contains(e) || e === M || u && !a.parentElement?.contains(e),
				onPick: (e) => {
					C = e, w = null, M.style.pointerEvents = "", I.hidden = !1, P.hidden = !1, ht(), I.focus();
				},
				onCancel: () => {
					w = null, M.style.pointerEvents = "", I.hidden = !1, P.hidden = !1, I.focus();
				}
			});
		}
	};
	for (let [e, t] of [
		["image", "Add image"],
		["voice", "Voice note"],
		["video", "Camera"],
		["screen", "Record screen"],
		["screenshot", "Screenshot"],
		["element", "Tag element"]
	]) {
		let n = H("", () => Promise.resolve(mt[e]()).catch(X));
		n.append(Me(e), V("span", t)), n.setAttribute("aria-label", t), ce.push([e, n]), je.append(n);
	}
	function ht() {
		U.hidden = !C, U.replaceChildren(), C && U.append(V("strong", `Tagged: ${C.label || C.tagName}`), V("p", C.selector), H("Remove tag", () => {
			C = null, ht();
		}));
	}
	function gt(e) {
		URL.revokeObjectURL(e.url), A.splice(A.indexOf(e), 1), _t();
	}
	function _t() {
		Le.replaceChildren();
		for (let e of A) {
			let t = V("div", "", "attachment"), n;
			e.file.type.startsWith("image/") ? (n = V("img"), n.alt = e.file.name) : (n = V(e.file.type.startsWith("audio/") ? "audio" : "video"), n.controls = !0, n.preload = "metadata"), n.src = e.url;
			let r = V("div", "", "attachment-row");
			r.append(V("span", `${e.file.name} · ${(e.file.size / 1024 / 1024).toFixed(1)} MB`)), e.file.type.startsWith("image/") && r.append(H("Redact", () => yt(e))), r.append(H("Remove", () => gt(e))), t.append(n, r), Le.append(t);
		}
		Z();
	}
	function vt() {
		D += 1, ct(), y = !1, $({ restoreFocus: !1 }), Q.cancel(), w?.(), w = null, M.style.pointerEvents = "";
		for (let e of A) URL.revokeObjectURL(e.url);
		A.splice(0), C = null, E = m.categories[0], x = null, S = "", G.value = "", L.reset(), L.hidden = !1, O?.remove(), O = null, W.className = "status", W.textContent = "";
		for (let [e, t] of j) t.setAttribute("aria-pressed", String(e === E));
		ae = !1, dt({ force: !0 }), _t(), ht(), Z();
	}
	function $({ restoreFocus: e = !0 } = {}) {
		let t = T;
		t && (T = null, t.dialog.open && t.dialog.close(), t.dialog.remove(), v || Z(), e && !v && (t.previousFocus?.isConnected ? t.previousFocus : I)?.focus?.());
	}
	async function yt(e) {
		if (T || v) return;
		let t = V("dialog", "", "redaction"), n = Ne(), r = V("h2", "Hide sensitive areas");
		r.id = n, t.setAttribute("aria-labelledby", n);
		let i = V("p", "Drag across any area to cover it. Redactions are applied before upload.", "hint"), a = V("canvas");
		a.hidden = !0;
		let o = V("div", "", "redaction-actions"), s = H("Cancel", () => $(), "secondary"), c = H("Apply redactions", () => d(), "secondary");
		c.disabled = !0, o.append(s, c), t.append(r, i, a, o), N.append(t);
		let l = {
			dialog: t,
			previousFocus: N.activeElement || document.activeElement
		};
		T = l, t.addEventListener("cancel", (e) => {
			e.preventDefault(), $();
		});
		try {
			t.showModal();
		} catch (e) {
			T = null, t.remove(), X(e), Z();
			return;
		}
		s.focus(), Z();
		let u = new Image();
		u.src = e.url;
		try {
			if (await u.decode(), v || T !== l) return;
			let e = Pe(u.naturalWidth, u.naturalHeight);
			a.width = e.width, a.height = e.height;
			let t = a.getContext("2d");
			if (!t) throw Error("Image redaction is not available in this browser.");
			t.drawImage(u, 0, 0, e.width, e.height), a.hidden = !1, c.disabled = !1;
			let n = null;
			a.addEventListener("pointerdown", (e) => {
				let t = a.getBoundingClientRect();
				n = {
					x: (e.clientX - t.left) * a.width / t.width,
					y: (e.clientY - t.top) * a.height / t.height
				}, a.setPointerCapture(e.pointerId);
			}), a.addEventListener("pointerup", (e) => {
				if (!n) return;
				let r = a.getBoundingClientRect(), i = (e.clientX - r.left) * a.width / r.width, o = (e.clientY - r.top) * a.height / r.height;
				t.fillStyle = "#172D29", t.fillRect(Math.min(n.x, i), Math.min(n.y, o), Math.max(Math.abs(i - n.x), 12), Math.max(Math.abs(o - n.y), 12)), n = null;
			}), a.addEventListener("pointercancel", () => {
				n = null;
			});
		} catch (e) {
			T === l && (X(e), $());
		}
		async function d() {
			if (!(v || T !== l || c.disabled)) {
				c.disabled = !0;
				try {
					let t = await new Promise((e) => a.toBlob(e, "image/png"));
					if (!t || v || T !== l) {
						!t && T === l && (X(/* @__PURE__ */ Error("The redacted image could not be created.")), $());
						return;
					}
					let n = new File([t], "redacted-image.png", { type: "image/png" });
					te(n, A.filter((t) => t !== e).map((e) => e.file));
					let r = URL.createObjectURL(n), i = e.url;
					e.id = Ne(), e.file = n, e.url = r, URL.revokeObjectURL(i), $({ restoreFocus: !1 }), _t(), I.focus();
				} catch (e) {
					X(e), T === l && $();
				}
			}
		}
	}
	function bt() {
		return {
			pageUrl: location.origin + location.pathname,
			pageTitle: document.title.slice(0, 160),
			viewport: {
				width: innerWidth,
				height: innerHeight
			},
			...C ? { element: C } : {}
		};
	}
	async function xt(e) {
		if (e.preventDefault(), y || b || T || !L.reportValidity()) return;
		if (se || Ct(), !m.endpoint && typeof oe != "function") {
			X(/* @__PURE__ */ Error("Feedback delivery is not connected. Please contact this site’s team. Your draft is still here."));
			return;
		}
		if (!u && m.allowedOrigins.length && !m.allowedOrigins.includes(location.origin)) {
			X(/* @__PURE__ */ Error("This website is not enabled for this feedback widget."));
			return;
		}
		let t = bt(), n = D, a = {
			version: 1,
			...r ? { boardId: r } : {},
			...i ? { widgetId: i } : {},
			title: R.value.trim(),
			description: z.value.trim(),
			category: E,
			email: B.value.trim(),
			user: h,
			context: t,
			attachments: A.map((e) => ({
				file: e.file,
				kind: e.kind,
				durationMs: e.durationMs
			})),
			consent: !0
		};
		if (!a.title || !a.description) {
			X(/* @__PURE__ */ Error("Add a title and describe your feedback."));
			return;
		}
		let o = JSON.stringify([
			a.title,
			a.description,
			E,
			a.email,
			a.user,
			t,
			A.map((e) => e.id)
		]);
		S !== o && (x = Ne(), S = o), a.requestId = x, y = !0, W.textContent = "", Z();
		try {
			let e = typeof oe == "function" ? await oe(a) : await Ie(m.endpoint, a, m.delivery);
			if (v || n !== D) return;
			if (!e || typeof e.id != "string" || !e.id) throw Error("No save confirmation was returned. Retry to recover the same request.");
			for (let e of A) URL.revokeObjectURL(e.url);
			A.splice(0), C = null, L.reset(), R.value = "", z.value = "", ae = !1, dt({ force: !0 }), x = null, S = "", se = !1, _t(), ht();
			let t = V("div", "", "success");
			t.append(V("strong", "Feedback received"), V("p", m.successMessage), H("Send another", () => {
				t.remove(), O = null, L.hidden = !1, R.focus();
			}, "secondary")), et() && t.append(H("Back to home", () => {
				t.remove(), O = null, nt("home");
			}, "secondary")), O = t, L.hidden = !0, ve.append(t);
		} catch (e) {
			!v && n === D && X(e);
		} finally {
			n === D && (y = !1, v || Z());
		}
	}
	L.addEventListener("submit", xt), I.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && (e.preventDefault(), Tt()), e.key !== "Tab") return;
		let t = [...N.querySelectorAll("button,input,textarea,select,a")].filter((e) => !e.disabled && !e.hidden && e.getClientRects().length).filter((e) => I.contains(e)), n = t[0], r = t.at(-1);
		e.shiftKey && N.activeElement === n ? (e.preventDefault(), r?.focus()) : !e.shiftKey && N.activeElement === r && (e.preventDefault(), n?.focus());
	});
	function St() {
		return !!(R.value || z.value || q.value || Y.length || A.length);
	}
	function Ct() {
		let e = typeof l == "function" ? l() : null;
		if (e && typeof e.then == "function") throw Error("Widget onOpen must return synchronously.");
		if (e != null && (typeof e != "object" || Array.isArray(e))) throw Error("Widget onOpen must return receiver options.");
		if ((e?.config || Object.hasOwn(e || {}, "user")) && kt({
			...e.config ? { config: e.config } : {},
			...Object.hasOwn(e || {}, "user") ? { user: e.user } : {}
		}), oe = Object.hasOwn(e || {}, "onSubmit") ? e.onSubmit : s, k = Object.hasOwn(e || {}, "onAsk") ? e.onAsk : c, oe != null && typeof oe != "function") throw Error("Widget onOpen onSubmit must be a function.");
		if (k != null && typeof k != "function") throw Error("Widget onOpen onAsk must be a function.");
		se = !0;
	}
	function wt({ focus: e = !0 } = {}) {
		v || ((!se || !St()) && Ct(), re = e, ne = e ? document.activeElement : null, I.hidden = !1, Et(), et() && J === "feedback" && !O && !R.value && !z.value && nt("home", { focus: !1 }), e && ge.focus());
	}
	function Tt() {
		$({ restoreFocus: !1 }), Q.cancel(), w?.(), w = null, I.hidden = !0, P.hidden = !1, Et(), re && (ne?.isConnected ? ne : P)?.focus?.(), ne = null, re = !1;
	}
	function Et() {
		let e = !I.hidden, t = m.launcherStyle === "pill" && !e;
		if (P.classList.toggle("is-pill", t), e) P.replaceChildren(Me("close"));
		else {
			let e;
			m.launcherIcon === "auto" && m.logoUrl && m.logoUrl !== ue ? (F.getAttribute("src") !== m.logoUrl && (F.src = m.logoUrl), e = F) : e = Me(m.launcherIcon === "auto" || m.launcherIcon === "message" ? "launcher" : m.launcherIcon), P.replaceChildren(...t ? [e, V("span", m.launcherText)] : [e]);
		}
		P.setAttribute("aria-expanded", String(e)), P.setAttribute("aria-label", e ? "Close feedback" : m.launcherText), P.title = e ? "Close feedback" : m.launcherText;
	}
	function Dt() {
		let e = p ?? globalThis.innerWidth, t = u ? a.clientWidth || e : globalThis.innerWidth, n = u && a.clientHeight || globalThis.innerHeight, r = g(m, e), i = ee({
			viewportWidth: t,
			viewportHeight: n,
			offsetX: r.offsetX,
			offsetY: r.offsetY,
			panelWidth: m.panelWidth
		}), o = r.position === "left" ? "left" : "right";
		M.toggleAttribute("data-left", o === "left"), M.toggleAttribute("data-mobile", r.mobile), M.style.setProperty("--launcher-edge-x", `max(${i.launcherInsetX}px, env(safe-area-inset-${o}))`), M.style.setProperty("--launcher-edge-y", `max(${i.launcherInsetY}px, env(safe-area-inset-bottom))`), M.style.setProperty("--panel-edge-x", `max(${i.panelInsetX}px, env(safe-area-inset-${o}))`), M.style.setProperty("--panel-opposite-edge-x", `max(8px, env(safe-area-inset-${o === "left" ? "right" : "left"}))`), M.style.setProperty("--panel-edge-y", `max(${i.panelInsetY}px, env(safe-area-inset-bottom))`), M.style.setProperty("--panel-top-gutter", "max(8px, env(safe-area-inset-top))"), M.style.setProperty("--panel-width", `${i.panelMaxWidth}px`), M.style.setProperty("--panel-max-height", `${i.panelMaxHeight}px`);
	}
	function Ot() {
		let e = m.theme === "dark";
		M.style.cssText = [
			`--font:${n(m)}`,
			`--panel-width:${m.panelWidth}px`,
			`--accent:${m.accent}`,
			`--on-accent:${f(m.accent)}`,
			`--surface:${e ? "#182723" : m.background}`,
			`--text:${e ? "#F1F7F4" : m.textColor}`,
			`--muted:${e ? "#B7C7BF" : "#62756F"}`,
			`--line:${e ? "#3B4E46" : "#DDE7E2"}`,
			`--soft:${e ? "#24382F" : "#F3F7F5"}`,
			`--radius:${m.radius}px`
		].join(";"), Dt(), w && (M.style.pointerEvents = "none"), de.classList.toggle("is-plain", m.headerStyle === "plain"), m.categories.includes(E) || (E = m.categories[0]);
		for (let [e, t] of j) t.hidden = !m.categories.includes(e), t.setAttribute("aria-pressed", String(e === E));
		ye.hidden = m.categories.length < 2, me.textContent = m.title, he.textContent = m.greeting, Re.hidden = m.delivery === "builtin", Ve.textContent = m.delivery === "builtin" ? "Send this feedback, my contact details if provided, and this page’s address." : "Send the text and attachments shown here, my contact details if provided, plus this page’s address and any element I tag.", pe.hidden = !m.logoUrl, m.logoUrl ? pe.src = m.logoUrl : pe.removeAttribute("src"), Et(), Ce.hidden = m.collectEmail === "off", B.required = m.collectEmail === "required", dt(), Ue.hidden = !m.showBranding, lt(), O && (O.querySelector("p").textContent = m.successMessage), Z();
	}
	function kt(e) {
		if (v) throw Error("This feedback widget has been destroyed. Call FeedbackStudio.boot(options) to start a new one.");
		if (!e || typeof e != "object" || Array.isArray(e)) throw Error("Widget updates must be an object with config and/or user.");
		for (let t of Object.keys(e)) if (!["config", "user"].includes(t)) throw Error(`Widget update contains an unsupported option: ${t}.`);
		let t = m;
		if (Object.hasOwn(e, "config")) {
			let n = e.config;
			if (!n || typeof n != "object" || Array.isArray(n)) throw Error("Widget config updates must be an object.");
			if (Object.hasOwn(n, "capture") && (!n.capture || typeof n.capture != "object" || Array.isArray(n.capture))) throw Error("Widget capture updates must be an object.");
			t = d({
				...m,
				...n,
				capture: {
					...m.capture,
					...n.capture || {}
				}
			});
		}
		let n = Object.hasOwn(e, "user"), r = n ? De(h, e.user) : h, i = n && (e.user === null || !!h != !!r || Ee(h) !== Ee(r));
		m = t, h = r, Ot(), ut(), i ? vt() : n && dt();
	}
	function At(e) {
		(b || R.value || z.value || A.length) && (e.preventDefault(), e.returnValue = "");
	}
	return window.addEventListener("beforeunload", At), window.addEventListener("resize", Dt), Ot(), ut(), dt({ force: !0 }), nt(et() ? "home" : "feedback", { focus: !1 }), {
		open: wt,
		close: Tt,
		update: kt,
		destroy() {
			v = !0, D += 1, y = !1, $({ restoreFocus: !1 }), Q.dispose(), w?.(), w = null;
			for (let e of A) URL.revokeObjectURL(e.url);
			A.splice(0), O?.remove(), O = null, h = null, window.removeEventListener("beforeunload", At), window.removeEventListener("resize", Dt), M.remove();
		},
		host: M
	};
}
async function Ie(e, t, n = "custom") {
	let r, i = { "Idempotency-Key": t.requestId }, { attachments: a, ...o } = t;
	if (n === "builtin") {
		if (a.length) throw Error("This feedback form accepts text only. Remove the attachments to send it.");
		let { requestId: e, title: n, description: o, category: s, email: c, user: l, context: u, consent: d } = t;
		r = JSON.stringify({
			requestId: e,
			title: n,
			description: o,
			category: s,
			email: c,
			...l ? { user: l } : {},
			context: u,
			consent: d
		}), delete i["Idempotency-Key"], i["Content-Type"] = "application/json";
	} else {
		let e = new FormData();
		e.append("feedback", JSON.stringify({
			...o,
			attachments: a.map((e) => ({
				name: e.file.name,
				type: e.file.type,
				size: e.file.size,
				kind: e.kind,
				durationMs: e.durationMs
			}))
		}));
		for (let t of a) e.append("files", t.file, t.file.name);
		r = e;
	}
	let s = new AbortController(), c = setTimeout(() => s.abort(), 6e4);
	try {
		let t = await fetch(e, {
			method: "POST",
			body: r,
			credentials: "omit",
			referrerPolicy: "no-referrer",
			headers: i,
			signal: s.signal
		}), n = await t.json().catch(() => null);
		if (!t.ok) throw Error(n?.message || "Feedback could not be sent. Your draft is still here.");
		return n;
	} finally {
		clearTimeout(c);
	}
}
//#endregion
//#region src/widget/sdk.js
var Le = /* @__PURE__ */ new Set([
	"boardId",
	"widgetId",
	"config",
	"inline",
	"onAsk",
	"onSubmit",
	"onOpen",
	"target",
	"user",
	"previewViewportWidth"
]), U = null, Re = 0;
function W(e, t) {
	if (!e || typeof e != "object" || Array.isArray(e)) throw Error(`${t} must be an object.`);
	return e;
}
function ze(e, t, n) {
	for (let r of Object.keys(e)) if (!t.has(r)) throw Error(`${n} contains an unsupported option: ${r}.`);
}
function Be(e = {}) {
	let t = W(e, "FeedbackStudio.boot options");
	if (ze(t, Le, "FeedbackStudio.boot options"), Object.hasOwn(t, "boardId") && typeof t.boardId != "string") throw Error("FeedbackStudio boardId must be a string.");
	if (Object.hasOwn(t, "widgetId") && typeof t.widgetId != "string") throw Error("FeedbackStudio widgetId must be a string.");
	if (Object.hasOwn(t, "inline") && typeof t.inline != "boolean") throw Error("FeedbackStudio inline must be true or false.");
	if (Object.hasOwn(t, "previewViewportWidth") && (!Number.isInteger(t.previewViewportWidth) || t.previewViewportWidth < 1 || t.previewViewportWidth > 1e4)) throw Error("FeedbackStudio preview viewport width must be a whole number between 1 and 10000.");
	if (Object.hasOwn(t, "previewViewportWidth") && !t.inline) throw Error("FeedbackStudio preview viewport width is only available for inline previews.");
	if (Object.hasOwn(t, "onSubmit") && typeof t.onSubmit != "function") throw Error("FeedbackStudio onSubmit must be a function.");
	if (Object.hasOwn(t, "onAsk") && typeof t.onAsk != "function") throw Error("FeedbackStudio onAsk must be a function.");
	if (Object.hasOwn(t, "onOpen") && typeof t.onOpen != "function") throw Error("FeedbackStudio onOpen must be a function.");
	let n = t.target ?? globalThis.document?.body;
	if (!n || typeof n.append != "function") throw Error("FeedbackStudio needs a valid target element after the page body is available.");
	return {
		...t,
		target: n,
		config: d(t.config || {}),
		user: Te(t.user)
	};
}
function Ve(e = {}) {
	Re += 1;
	let t = Be(e);
	return U?.destroy(), U = Fe(t), U;
}
//#endregion
//#region src/widget/app-entry.js
var He = Object.freeze(/* @__PURE__ */ "title.greeting.launcherText.submitText.successMessage.accent.background.textColor.logoUrl.font.position.launcherStyle.launcherIcon.headerStyle.panelWidth.customFont.categories.aiEnabled.aiName.aiIntro.links.radius.offset.desktopOffsetX.desktopOffsetY.mobileOffsetX.mobileOffsetY.mobilePosition.theme.collectEmail.showBranding.capture.delivery".split("."));
function Ue(e, t = {}) {
	let n = e && typeof e == "object" && !Array.isArray(e) ? e : {}, r = Object.fromEntries(He.filter((e) => Object.hasOwn(n, e)).map((e) => [e, n[e]])), i = d({
		...t,
		...r,
		endpoint: "",
		allowedOrigins: [],
		appSiteId: ""
	});
	return Object.fromEntries(He.map((e) => [e, i[e]]));
}
//#endregion
export { Ve as boot, Fe as mountFeedbackWidget, d as normalizeWidget, ee as placementGeometry, Ie as postFeedback, g as resolveWidgetPlacement, Ue as sanitizePublicWidgetConfig };

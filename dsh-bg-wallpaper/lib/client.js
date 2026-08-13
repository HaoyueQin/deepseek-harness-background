window.__ModuleLoader__.load({
	id: "dsh-bg-wallpaper",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region src/client/backdrop.ts
		/**
		* Compose the layered background-image value for one resolved section.
		* @param settings - resolved background section.
		* @param dark - whether the dark color scheme is active.
		* @returns a CSS `background-image` value (multiple comma-separated layers).
		*/
		function backdropImage(settings, dark) {
			const surface = dark ? "0, 0, 0" : "255, 255, 255";
			const veil = dark ? "0, 0, 0" : "255, 255, 255";
			const url = dark ? settings.darkUrl : settings.lightUrl;
			return [
				`linear-gradient(rgba(${surface}, ${1 - settings.opacity}) 0%, rgba(${surface}, ${1 - settings.opacity}) 100%)`,
				`linear-gradient(rgba(${veil}, ${settings.scrim}) 0%, rgba(${veil}, ${settings.scrim}) 100%)`,
				`url(${url})`
			].join(", ");
		}
		//#endregion
		//#region src/client/overlay-store.ts
		/**
		* Observable overlay visibility (getSnapshot/subscribe — the uSES currency).
		* Methods are arrow properties so React's useSyncExternalStore can call them
		* without an owning `this`.
		*/
		var OverlayStore = class {
			visible = false;
			listeners = /* @__PURE__ */ new Set();
			/** @returns whether the settings overlay is open. */
			getSnapshot = () => this.visible;
			/** Observe visibility changes. @returns the disposer removing this listener. */
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			/** Open the settings overlay. */
			open() {
				this.visible = true;
				this.notify();
			}
			/** Close the settings overlay. */
			close() {
				this.visible = false;
				this.notify();
			}
			notify() {
				for (const listener of this.listeners) listener();
			}
		};
		/** Shared overlay store for the settings entry card and the overlay. */
		const overlayStore = new OverlayStore();
		//#endregion
		//#region \0dsh-css:D:\Project\deepseek-harness-background\dsh-bg-wallpaper\src\client\entry-card.module.css.mjs
		const css$1 = ".-optwq_card{list-style:none}.-optwq_header{cursor:pointer;text-align:left;width:100%;font:inherit;color:var(--dsw-alias-label-primary);background:0 0;border:0;align-items:center;gap:8px;padding:10px 12px;display:flex}.-optwq_header:hover{background:var(--dsw-alias-bg-layer-1)}.-optwq_headText{flex-direction:column;gap:2px;min-width:0;display:flex}.-optwq_name{font-weight:600}.-optwq_description{color:var(--dsw-alias-label-secondary);font-size:12px}";
		const tagId$1 = "dsh-bg-wallpaper/entry-card.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-bg-wallpaper";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var entry_card_module_css_default = {
			"header": "-optwq_header",
			"headText": "-optwq_headText",
			"card": "-optwq_card",
			"name": "-optwq_name",
			"description": "-optwq_description"
		};
		//#endregion
		//#region src/client/entry-card.tsx
		/**
		* Render the background entry card.
		* @param props - locale copy.
		* @returns the card.
		*/
		function BackgroundEntryCard({ t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
				className: entry_card_module_css_default.card,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: entry_card_module_css_default.header,
					onClick: () => {
						overlayStore.open();
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: entry_card_module_css_default.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: entry_card_module_css_default.name,
							children: t("background.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: entry_card_module_css_default.description,
							children: t("background.entryHint")
						})]
					})
				})
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Chinese copy. */
		const zh = {
			"background.title": "自定义背景",
			"background.description": "为整个应用界面设置背景图片（明/暗主题各一张），可调不透明度与遮罩强度",
			"background.entryHint": "点击打开背景图片设置",
			"background.enabled": "启用",
			"background.lightUrl": "浅色图片",
			"background.darkUrl": "深色图片",
			"background.opacity": "不透明度",
			"background.scrim": "遮罩强度",
			"background.fit": "填充方式",
			"background.cover": "铺满",
			"background.contain": "完整",
			"background.preview": "启用并填入图片后，这里实时预览背景效果",
			"background.unsaved": "有未保存修改",
			"background.save": "保存",
			"background.saving": "保存中…",
			"background.close": "关闭",
			"background.discard": "放弃修改",
			"background.readOnly": "当前文档只读，无法修改",
			"background.saveFailed": "保存失败，请重试",
			"background.resetAll": "全部重置"
		};
		/** English copy. */
		const en = {
			"background.title": "Custom Background",
			"background.description": "Set a background image behind the whole app surface (one per light/dark theme), with opacity and scrim controls",
			"background.entryHint": "Open the background image settings",
			"background.enabled": "Enabled",
			"background.lightUrl": "Light image",
			"background.darkUrl": "Dark image",
			"background.opacity": "Opacity",
			"background.scrim": "Scrim",
			"background.fit": "Fit",
			"background.cover": "Cover",
			"background.contain": "Contain",
			"background.preview": "Enable and set an image to preview the background here",
			"background.unsaved": "Unsaved changes",
			"background.save": "Save",
			"background.saving": "Saving…",
			"background.close": "Close",
			"background.discard": "Discard",
			"background.readOnly": "This document is read-only",
			"background.saveFailed": "Save failed, try again",
			"background.resetAll": "Reset all"
		};
		//#endregion
		//#region src/routes.ts
		/** Browser-facing base path of the background API. */
		const BACKGROUND_API_PREFIX = "/api/bg-wallpaper";
		//#endregion
		//#region src/client/settings-client.ts
		/**
		* Observable settings client (getSnapshot/subscribe — the uSES currency).
		* Methods are arrow properties so React's useSyncExternalStore can call them
		* without an owning `this`.
		*/
		var SettingsClient = class {
			snapshot = { status: "loading" };
			listeners = /* @__PURE__ */ new Set();
			/** @returns the current sync snapshot (stable reference until the next change). */
			getSnapshot = () => this.snapshot;
			/** Observe snapshot replacements. @returns the disposer removing this listener. */
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			notify() {
				for (const listener of this.listeners) listener();
			}
			/** Fetch the section from the host. */
			async load() {
				try {
					const response = await fetch(`${BACKGROUND_API_PREFIX}/settings`);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const body = await response.json();
					if (!body.ok || body.value === void 0) throw new Error("unexpected payload");
					this.snapshot = {
						status: "ready",
						value: body.value
					};
				} catch {
					this.snapshot = { status: "error" };
				}
				this.notify();
			}
			/**
			* Persist the section through the host route.
			* @param section - the complete next section.
			* @returns whether the host accepted the write.
			*/
			async save(section) {
				try {
					const response = await fetch(`${BACKGROUND_API_PREFIX}/settings`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(section)
					});
					const body = await response.json();
					if (!response.ok || !body.ok || body.value === void 0) return false;
					this.snapshot = {
						status: "ready",
						value: body.value
					};
					this.notify();
					return true;
				} catch {
					return false;
				}
			}
		};
		/** Shared client for the painter and the settings overlay. */
		const settingsClient = new SettingsClient();
		//#endregion
		//#region \0dsh-css:D:\Project\deepseek-harness-background\dsh-bg-wallpaper\src\client\overlay.module.css.mjs
		const css = ".dgqQDG_backdrop{z-index:50;pointer-events:auto;background:#00000073;justify-content:center;align-items:center;display:flex;position:fixed;inset:0}.dgqQDG_panel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);width:min(560px,100vw - 48px);max-height:calc(100vh - 96px);color:var(--dsw-alias-label-primary);border-radius:10px;flex-direction:column;gap:12px;padding:16px;display:flex;overflow:auto;box-shadow:0 12px 40px #0000004d}.dgqQDG_panelHead{grid-template-columns:1fr auto;align-items:center;gap:2px 10px;display:grid}.dgqQDG_panelTitle{font-size:15px;font-weight:600}.dgqQDG_panelDesc{color:var(--dsw-alias-label-secondary);grid-column:1;font-size:12px}.dgqQDG_close{width:30px;height:30px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;grid-area:1/2/span 2;font-size:18px;line-height:1}.dgqQDG_close:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.dgqQDG_preview{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;height:160px;position:relative;overflow:hidden}.dgqQDG_previewEmpty{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);place-items:center;font-size:12px;display:grid;position:absolute;inset:0}.dgqQDG_field{align-items:center;gap:10px;font-size:13px;display:flex}.dgqQDG_fieldLabel{width:84px;color:var(--dsw-alias-label-secondary);flex:none}.dgqQDG_field input[type=text]{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);min-width:0;color:var(--dsw-alias-label-primary);font:inherit;border-radius:6px;flex:1;padding:6px 8px}.dgqQDG_field input[type=checkbox]{accent-color:var(--dsw-alias-brand-primary)}.dgqQDG_rangeWrap{flex:1;align-items:center;gap:8px;display:flex}.dgqQDG_rangeWrap input[type=range]{accent-color:var(--dsw-alias-brand-primary);flex:1}.dgqQDG_rangeValue{text-align:right;font-variant-numeric:tabular-nums;width:40px;color:var(--dsw-alias-label-primary);flex:none}.dgqQDG_segmented{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;display:inline-flex;overflow:hidden}.dgqQDG_segment{border:0;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;padding:5px 12px;font-size:12px}.dgqQDG_segment:last-child{border-right:0}.dgqQDG_segmentActive{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand)}.dgqQDG_footer{justify-content:flex-end;align-items:center;gap:8px;padding-top:4px;display:flex}.dgqQDG_failed{color:var(--dsw-alias-state-error-primary);margin-right:auto;font-size:12px}.dgqQDG_footer button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:6px;padding:6px 14px;font-size:12px}.dgqQDG_footer button:disabled{opacity:.5;cursor:default}.dgqQDG_footer .dgqQDG_save{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand)}";
		const tagId = "dsh-bg-wallpaper/overlay.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-bg-wallpaper";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var overlay_module_css_default = {
			"backdrop": "dgqQDG_backdrop",
			"segment": "dgqQDG_segment",
			"panelTitle": "dgqQDG_panelTitle",
			"segmented": "dgqQDG_segmented",
			"failed": "dgqQDG_failed",
			"panelHead": "dgqQDG_panelHead",
			"panel": "dgqQDG_panel",
			"panelDesc": "dgqQDG_panelDesc",
			"previewEmpty": "dgqQDG_previewEmpty",
			"close": "dgqQDG_close",
			"fieldLabel": "dgqQDG_fieldLabel",
			"field": "dgqQDG_field",
			"rangeWrap": "dgqQDG_rangeWrap",
			"footer": "dgqQDG_footer",
			"preview": "dgqQDG_preview",
			"segmentActive": "dgqQDG_segmentActive",
			"rangeValue": "dgqQDG_rangeValue",
			"save": "dgqQDG_save"
		};
		//#endregion
		//#region src/client/overlay.tsx
		/**
		* Background settings overlay — the editable form for the `ui-background`
		* section, drawn by the plugin itself (registered into the `shell.overlay`
		* slot) because the api-proxy settings allowlist does not expose third-party
		* namespaces over the settings RPC. The overlay talks to the plugin's own
		* host route (`/api/bg-wallpaper/settings`) and shows a live preview of the
		* draft — what the user sees is exactly what the app paints.
		*/
		/** Defaults mirror the host schema (also the pre-load draft fallback). */
		const DEFAULTS = {
			enabled: false,
			lightUrl: "",
			darkUrl: "",
			opacity: 1,
			scrim: .25,
			fit: "cover"
		};
		/** Stable comparison so staged edits preview without touching the document. */
		function shallowDirty(draft, applied) {
			return Object.keys(draft).some((key) => draft[key] !== applied[key]);
		}
		/**
		* Render the settings overlay: a dim scrim over the whole app, a centered
		* panel with the live draft preview and the section controls.
		* @param props - locale copy.
		* @returns the overlay, or nothing while closed.
		*/
		function BackgroundOverlay({ t }) {
			const open = (0, react.useSyncExternalStore)(overlayStore.subscribe, overlayStore.getSnapshot);
			const [applied, setApplied] = (0, react.useState)(void 0);
			const [draft, setDraft] = (0, react.useState)({ ...DEFAULTS });
			const [saving, setSaving] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!open) return;
				settingsClient.load().then(() => {
					const snapshot = settingsClient.getSnapshot();
					if (snapshot.status === "ready" && snapshot.value !== void 0) {
						setApplied(snapshot.value);
						setDraft(snapshot.value);
						setFailed(false);
					} else setFailed(true);
				});
			}, [open]);
			if (!open) return null;
			const dirty = applied === void 0 || shallowDirty(draft, applied);
			const patch = (field, value) => {
				setDraft((current) => ({
					...current,
					[field]: value
				}));
				setFailed(false);
			};
			const save = async () => {
				setSaving(true);
				setFailed(false);
				if (await settingsClient.save(draft)) setApplied({ ...draft });
				else setFailed(true);
				setSaving(false);
			};
			const dark = document.body.dataset.dsDarkTheme !== void 0;
			const previewStyle = {
				backgroundImage: backdropImage(draft, dark),
				backgroundPosition: "center",
				backgroundSize: draft.fit,
				backgroundAttachment: "fixed",
				backgroundRepeat: "no-repeat"
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: overlay_module_css_default.backdrop,
				onClick: (event) => {
					if (event.target === event.currentTarget) overlayStore.close();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: overlay_module_css_default.panel,
					role: "dialog",
					"aria-label": t("background.title"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: overlay_module_css_default.panelHead,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: overlay_module_css_default.panelTitle,
									children: t("background.title")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: overlay_module_css_default.panelDesc,
									children: t("background.description")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: overlay_module_css_default.close,
									onClick: () => {
										overlayStore.close();
									},
									"aria-label": t("background.close"),
									children: "×"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: overlay_module_css_default.preview,
							"data-testid": "bg-overlay-preview",
							style: previewStyle,
							"aria-hidden": "true",
							children: draft.enabled && (dark ? draft.darkUrl : draft.lightUrl) ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: overlay_module_css_default.previewEmpty,
								children: t("background.preview")
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: overlay_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: overlay_module_css_default.fieldLabel,
								children: t("background.enabled")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: draft.enabled,
								onChange: (event) => {
									patch("enabled", event.currentTarget.checked);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: overlay_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: overlay_module_css_default.fieldLabel,
								children: t("background.lightUrl")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								value: draft.lightUrl,
								placeholder: "https://…",
								onChange: (event) => {
									patch("lightUrl", event.currentTarget.value);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: overlay_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: overlay_module_css_default.fieldLabel,
								children: t("background.darkUrl")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								value: draft.darkUrl,
								placeholder: "https://…",
								onChange: (event) => {
									patch("darkUrl", event.currentTarget.value);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: overlay_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: overlay_module_css_default.fieldLabel,
								children: t("background.opacity")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: overlay_module_css_default.rangeWrap,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "range",
									min: 0,
									max: 1,
									step: .05,
									value: draft.opacity,
									onChange: (event) => {
										patch("opacity", Number(event.currentTarget.value));
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: overlay_module_css_default.rangeValue,
									children: [Math.round(draft.opacity * 100), "%"]
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: overlay_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: overlay_module_css_default.fieldLabel,
								children: t("background.scrim")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: overlay_module_css_default.rangeWrap,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "range",
									min: 0,
									max: .95,
									step: .05,
									value: draft.scrim,
									onChange: (event) => {
										patch("scrim", Number(event.currentTarget.value));
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: overlay_module_css_default.rangeValue,
									children: [Math.round(draft.scrim * 100), "%"]
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: overlay_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: overlay_module_css_default.fieldLabel,
								children: t("background.fit")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: overlay_module_css_default.segmented,
								children: ["cover", "contain"].map((fit) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: overlay_module_css_default.segment + (draft.fit === fit ? " " + overlay_module_css_default.segmentActive : ""),
									onClick: () => {
										patch("fit", fit);
									},
									children: t(fit === "cover" ? "background.cover" : "background.contain")
								}, fit))
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
							className: overlay_module_css_default.footer,
							children: [
								failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: overlay_module_css_default.failed,
									role: "status",
									children: t("background.saveFailed")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: overlay_module_css_default.cancel,
									onClick: () => {
										overlayStore.close();
									},
									children: t("background.close")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: overlay_module_css_default.save,
									disabled: !dirty || saving,
									onClick: () => {
										save();
									},
									children: t(saving ? "background.saving" : "background.save")
								})
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Body properties this plugin owns while active. */
		const BACKDROP_PROPERTIES = [
			"background-image",
			"background-position",
			"background-size",
			"background-attachment",
			"background-repeat"
		];
		/**
		* Render the user background behind the app frame. `body` and the frame's
		* `--dsw-alias-bg-base` paint the base surface; the center column has no
		* background of its own, so the image shows through every column. Light art
		* gets a white readability veil, dark art a black one, at the user-chosen
		* strength; the veil swaps live with the `data-ds-dark-theme` attribute the
		* theme system toggles.
		*/
		var BackgroundPainter = class {
			previous = /* @__PURE__ */ new Map();
			observer;
			settings;
			/**
			* (Re)apply the background from the latest settings; idempotent.
			* @param settings - resolved background section.
			*/
			apply(settings) {
				if (this.settings === void 0) {
					const body = document.body;
					for (const prop of BACKDROP_PROPERTIES) this.previous.set(prop, body.style.getPropertyValue(prop));
					this.observer = new MutationObserver(() => this.paint());
					this.observer.observe(body, {
						attributes: true,
						attributeFilter: ["data-ds-dark-theme"]
					});
				}
				this.settings = settings;
				this.paint();
			}
			/** Repaint with the current settings; no-op while inactive. */
			paint() {
				const settings = this.settings;
				if (settings === void 0) return;
				const body = document.body;
				const dark = body.dataset.dsDarkTheme !== void 0;
				body.style.setProperty("background-image", backdropImage(settings, dark));
				body.style.setProperty("background-position", "center");
				body.style.setProperty("background-size", settings.fit);
				body.style.setProperty("background-attachment", "fixed");
				body.style.setProperty("background-repeat", "no-repeat");
			}
			/** Restore every owned property and stop observing the theme attribute. */
			dispose() {
				this.observer?.disconnect();
				this.observer = void 0;
				this.settings = void 0;
				for (const [prop, value] of this.previous) document.body.style.setProperty(prop, value);
				this.previous.clear();
			}
		};
		/**
		* Service injections this entry declares: the `slots` (runtime) and `locale`
		* services only — the settings surface talks to the plugin's own host route
		* over plain same-origin fetch, so no settings/connection service is needed.
		* Mirrors the framework choreography: the package manifest (dsh.client.inject)
		* pins the module-table dependencies and this declaration names the cordis
		* services `apply` reads.
		*/
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: paint the background live and register the settings
		* surface (entry card + overlay).
		* @param ctx - client cordis context (slots/locale injected).
		*/
		function apply(ctx) {
			const painter = new BackgroundPainter();
			const paint = () => {
				const snapshot = settingsClient.getSnapshot();
				const value = snapshot.status === "ready" ? snapshot.value : void 0;
				if (value === void 0 || !value.enabled) {
					painter.dispose();
					return;
				}
				painter.apply(value);
			};
			const unsubscribe = settingsClient.subscribe(paint);
			settingsClient.load();
			ctx.effect(() => ctx.locale.register("ui-background", {
				zh,
				en
			}), "dsh-bg-wallpaper: dictionaries");
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				id: "ui-bg-wallpaper",
				order: 0,
				locale: "ui-background"
			}, BackgroundEntryCard));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "ui-bg-wallpaper-overlay",
				order: 0,
				locale: "ui-background"
			}, BackgroundOverlay));
			ctx.effect(() => () => {
				unsubscribe();
				painter.dispose();
			}, "dsh-bg-wallpaper: background surface");
		}
		//#endregion
		exports.BackgroundPainter = BackgroundPainter;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
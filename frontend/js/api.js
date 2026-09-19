(function () {
  const sessionKey = "presentStudio.session";
  const tokenKey = "presentStudio.accessToken";
  async function request(path, options = {}) {
    const { publicAccess = false, ...fetchOptions } = options;
    const token = publicAccess ? "" : localStorage.getItem(tokenKey);
    let response;
    try {
      response = await fetch(path, { credentials: publicAccess ? "omit" : "include", headers: { ...(fetchOptions.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(fetchOptions.headers || {}) }, ...fetchOptions });
    } catch { throw new Error("Backend not reachable. Start the FastAPI server and open http://127.0.0.1:8000."); }
    const body = await response.json().catch(() => ({}));
    if (!publicAccess && response.status === 401 && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/signup")) {
      localStorage.removeItem(sessionKey);
      localStorage.removeItem(tokenKey);
      if (!window.location.pathname.endsWith("/login.html") && window.location.pathname !== "/") {
        window.location.replace("/login.html?reason=session-expired");
      }
      throw new Error("Your session expired. Sign in again to continue.");
    }
    if (!response.ok) throw new Error(body.detail || body.error || `Request failed (${response.status})`);
    return body;
  }
  function persist(result) { localStorage.setItem(sessionKey, JSON.stringify(result.user)); localStorage.setItem(tokenKey, result.accessToken); return result; }
  window.PresentStudioApi = {
    login: (email, password) => request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }).then(persist),
    signup: (name, email, password) => request("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) }).then(persist),
    async logout() { const result = await request("/api/auth/logout", { method: "POST" }); localStorage.removeItem(sessionKey); localStorage.removeItem(tokenKey); return result; },
    getCurrentUser: () => request("/api/auth/me"), getCachedSession: () => { try { return JSON.parse(localStorage.getItem(sessionKey) || "null"); } catch { return null; } },
    listPresentations: () => request("/api/presentations"), getPresentation: (id, token = "", options = {}) => request(`/api/presentations/${encodeURIComponent(id)}${token ? `?token=${encodeURIComponent(token)}` : ""}`, options),
    resolveShareLink: (token, options = {}) => request(`/api/presentations/shared/${encodeURIComponent(token)}`, options),
    createPresentation: (title) => request("/api/presentations", { method: "POST", body: JSON.stringify({ title }) }), savePresentation: (deck) => request(`/api/presentations/${encodeURIComponent(deck.id)}`, { method: "PUT", body: JSON.stringify(deck) }), deletePresentation: (id) => request(`/api/presentations/${encodeURIComponent(id)}`, { method: "DELETE" }),
    getCurrentShareLink: (id) => request(`/api/presentations/${encodeURIComponent(id)}/share/current`),
    createShareLink: (id, permission = "viewer", screenAccessCode = "") => request(`/api/presentations/${encodeURIComponent(id)}/share`, { method: "POST", body: JSON.stringify({ permission, ...(screenAccessCode ? { screenAccessCode } : {}) }) }), getLiveSession: (id) => request(`/api/presentations/${encodeURIComponent(id)}/live`), setLiveSlide: (id, slideId, token = "") => request(`/api/presentations/${encodeURIComponent(id)}/live/slide${token ? `?token=${encodeURIComponent(token)}` : ""}`, { method: "POST", body: JSON.stringify({ slideId }) }), endLiveSession: (id) => request(`/api/presentations/${encodeURIComponent(id)}/live/end`, { method: "POST" }),
    getLiveMediaToken: (id, payload = {}, options = {}) => request(`/api/presentations/${encodeURIComponent(id)}/live/media-token`, { method: "POST", body: JSON.stringify(payload), ...options }),
    getScreenAccessRequirements: (id, token = "", options = {}) => request(`/api/presentations/${encodeURIComponent(id)}/screen-access${token ? `?token=${encodeURIComponent(token)}` : ""}`, options),
    verifyScreenAccessCode: (id, token, screenAccessCode, options = {}) => request(`/api/presentations/${encodeURIComponent(id)}/screen-access`, { method: "POST", body: JSON.stringify({ token, screenAccessCode }), ...options }),
    getScreenPresentation: (id, token = "", screenCode = "") => request(`/api/presentations/${encodeURIComponent(id)}?screen=1${token ? `&token=${encodeURIComponent(token)}` : ""}${screenCode ? `&screenCode=${encodeURIComponent(screenCode)}` : ""}`),
    listMedia: () => request("/api/media"), uploadMedia: (file) => { const form = new FormData(); form.append("file", file); return request("/api/media/upload", { method: "POST", body: form }); },
    listAdminUsers: () => request("/api/admin/users"),
    updatePresentationLimit: (userId, presentationLimit) => request(`/api/admin/users/${encodeURIComponent(userId)}/presentation-limit`, { method: "PATCH", body: JSON.stringify({ presentationLimit }) }),
    updateStorageLimit: (userId, storageLimitBytes) => request(`/api/admin/users/${encodeURIComponent(userId)}/storage-limit`, { method: "PATCH", body: JSON.stringify({ storageLimitBytes }) }),
    revokeUser: (userId) => request(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" })
  };
})();

/* MEETING_V2_BRIDGE
 * Persistent guest admission, co-host controls and screen-share routing.
 * Loaded from api.js before live-media.js so existing meeting code stays intact.
 */
(function installMeetingV2Bridge() {
  "use strict";

  const api = window.PresentStudioApi;
  if (!api || api.__meetingV2Installed) return;
  api.__meetingV2Installed = true;

  const contexts = new Map();
  const GUEST_KEY = "presentStudio.meetingGuestId";
  let fallbackGuestId = "";

  function newGuestId() {
    const value = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `guest-${value}`.slice(0, 128);
  }

  function stableGuestId() {
    try {
      let value = localStorage.getItem(GUEST_KEY);
      if (!value) {
        value = newGuestId();
        localStorage.setItem(GUEST_KEY, value);
      }
      return String(value).slice(0, 128);
    } catch {
      fallbackGuestId ||= newGuestId();
      return fallbackGuestId;
    }
  }

  function escapeSelector(value) {
    if (window.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function installStyle() {
    if (document.getElementById("meetingV2Styles")) return;
    const style = document.createElement("style");
    style.id = "meetingV2Styles";
    style.textContent = `
      .meeting-v2-role-badge {
        display:inline-flex;align-items:center;margin-left:6px;border:1px solid #d3aa0d;
        border-radius:999px;padding:2px 6px;background:#ffd54a;color:#171713;
        font:800 .5rem var(--mono,monospace);text-transform:uppercase;letter-spacing:.04em;
      }
      .live-participant-actions .meeting-v2-role-button {
        width:36px;min-width:36px;min-height:36px;display:grid;place-items:center;
        border:1px solid #665f43;border-radius:8px;padding:0;background:#2c2a22;color:#ffe48a;
      }
      .live-participant-actions .meeting-v2-role-button svg { width:19px;height:19px; }
      .live-participant-actions .meeting-v2-role-button.is-cohost {
        border-color:#8c6b00;background:#3b3214;color:#ffd54a;
      }
      .meeting-v2-cohost-control {
        border-color:#d3aa0d !important;background:#332c13 !important;color:#ffd54a !important;
      }
      .meeting-v2-revoked-overlay {
        position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:24px;
        background:rgba(10,10,9,.94);color:#fff;text-align:center;
      }
      .meeting-v2-revoked-overlay > div { max-width:520px; }
      .meeting-v2-revoked-overlay h2 { margin:0 0 10px; }
      .meeting-v2-revoked-overlay p { color:#c9c6bc;line-height:1.55; }
      body[data-meeting-cohost="1"] #backToEditor { display:none !important; }
    `;
    document.head.append(style);
  }

  installStyle();

  const originalGetLiveMediaToken = api.getLiveMediaToken.bind(api);
  api.getLiveMediaToken = async function meetingV2MediaToken(id, payload = {}, options = {}) {
    const ctx = contexts.get(String(id));
    const nextPayload = ctx?.stableClientId
      ? { ...payload, clientId: ctx.stableClientId }
      : payload;
    return originalGetLiveMediaToken(id, nextPayload, options);
  };

  function translateOutgoing(ctx, event, raw) {
    const data = raw && typeof raw === "object" ? { ...raw } : raw;
    if (!data || typeof data !== "object") return data;

    if (!ctx.isController && [
      "meeting_admission_request",
      "meeting_participant_joined",
      "meeting_participant_left",
      "meeting_screen_share_request"
    ].includes(event)) {
      if (data.clientId) ctx.ephemeralClientId = String(data.clientId);
      data.clientId = ctx.stableClientId;
    }

    if (ctx.isCohostController && event === "meeting_controller_register") {
      data.cohostGuestId = ctx.stableClientId;
    }

    if (ctx.isController && event === "meeting_screen_share_decide" && data.accepted === true) {
      const rawIds = Array.isArray(data.clientIds) ? data.clientIds : [data.clientId];
      const requests = Array.isArray(ctx.lastLobby?.screenShareRequests) ? ctx.lastLobby.screenShareRequests : [];
      const chosen = rawIds
        .map(clientId => requests.find(item => String(item.clientId) === String(clientId)))
        .find(item => item?.identity);
      if (chosen?.identity) ctx.preferredShareIdentity = String(chosen.identity);
    }
    return data;
  }

  function translateIncoming(ctx, event, raw) {
    if (!raw || typeof raw !== "object") return raw;
    const data = { ...raw };
    if (!ctx.isController && [
      "meeting_admission_decision",
      "meeting_removed_by_controller",
      "meeting_screen_share_decision"
    ].includes(event) && String(data.clientId || "") === ctx.stableClientId && ctx.ephemeralClientId) {
      data.clientId = ctx.ephemeralClientId;
    }
    return data;
  }

  function scheduleControllerDecoration(ctx) {
    if (!ctx.isController || !ctx.root) return;

    (ctx.decorationTimers || []).forEach(timer => clearTimeout(timer));
    ctx.decorationTimers = [];

    // Lobby state can arrive just before LiveKit creates the participant tile.
    // Retry a few times, then stop. This is intentionally bounded: never watch
    // the live DOM continuously.
    [0, 80, 200, 500, 1000].forEach(delay => {
      const timer = window.setTimeout(() => {
        decorateControllerParticipants(ctx);
      }, delay);
      ctx.decorationTimers.push(timer);
    });
  }

  function makeSocketProxy(ctx, socket) {
    if (!socket) return socket;
    return new Proxy(socket, {
      get(target, property) {
        if (property === "emit") {
          return (event, data, ...rest) =>
            target.emit(event, translateOutgoing(ctx, event, data), ...rest);
        }
        if (property === "on") {
          return (event, handler) => {
            target.on(event, (...args) => {
              const original = args[0];
              const translated = translateIncoming(ctx, event, original);
              if (event === "meeting_lobby_state" && ctx.isController) {
                ctx.lastLobby = original;
              }
              handler(translated, ...args.slice(1));

              if (event === "meeting_lobby_state" && ctx.isController) {
                scheduleControllerDecoration(ctx);
              }
              if (event === "meeting_admission_decision" && !ctx.isController && original?.accepted) {
                applyLocalRole(ctx, original);
              }
            });
            return target;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  }

  function roleButton(ctx, item) {
    const button = document.createElement("button");
    const isCohost = item.role === "cohost";
    button.type = "button";
    button.className = `meeting-v2-role-button${isCohost ? " is-cohost" : ""}`;
    button.dataset.meetingV2Role = String(item.clientId);
    button.dataset.meetingV2RoleState = isCohost ? "cohost" : "audience";
    button.innerHTML = isCohost
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><path d="M3.5 19c.3-3 2.2-5 5.5-5s5.2 2 5.5 5M16 12h6"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><path d="M3.5 19c.3-3 2.2-5 5.5-5s5.2 2 5.5 5M19 9v6M16 12h6"></path></svg>';
    const label = isCohost
      ? `Remove co-host access from ${item.name || "participant"}`
      : `Give ${item.name || "participant"} co-host controls`;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", event => {
      event.stopPropagation();
      ctx.socket.emit("meeting_role_update", {
        presentationId: ctx.presentationId,
        authToken: ctx.options.authToken || "",
        shareToken: ctx.options.shareToken || "",
        clientId: item.clientId,
        role: isCohost ? "audience" : "cohost"
      });
    });
    return button;
  }

  function decorateControllerParticipants(ctx) {
    if (!ctx.isController || !ctx.root || !ctx.lastLobby) return;
    const active = Array.isArray(ctx.lastLobby.active) ? ctx.lastLobby.active : [];
    active.forEach(item => {
      if (!item.identity) return;
      const tile = ctx.root.querySelector(
        `[data-participant-identity="${escapeSelector(item.identity)}"]`
      );
      if (!tile) return;

      const footer = tile.querySelector("footer");
      const label = footer?.querySelector("strong");
      let badge = footer?.querySelector(".meeting-v2-role-badge");
      if (item.role === "cohost") {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "meeting-v2-role-badge";
          badge.textContent = "Co-host";
          label?.after(badge);
        }
        const state = footer?.querySelector("span:not(.meeting-v2-role-badge):not(.live-raised-hand)");
        if (state?.textContent?.startsWith("Audience")) {
          state.textContent = state.textContent.replace(/^Audience/, "Co-host");
        }
      } else {
        badge?.remove();
      }

      const actions = tile.querySelector(".live-participant-actions");
      if (!actions) return;

      // IMPORTANT: keep this decoration idempotent.
      // The controller watches participant DOM mutations. Replacing this button
      // on every pass triggers the observer again and creates an infinite
      // mutation loop as soon as an active participant appears.
      const selector = `[data-meeting-v2-role="${escapeSelector(item.clientId)}"]`;
      const existingButton = actions.querySelector(selector);
      const expectedRole = item.role === "cohost" ? "cohost" : "audience";

      if (!existingButton) {
        actions.prepend(roleButton(ctx, item));
      } else if (existingButton.dataset.meetingV2RoleState !== expectedRole) {
        // Role actually changed (audience <-> co-host), so rebuild once to
        // refresh the click handler's captured role. The next observer pass is
        // stable and performs no DOM mutation.
        existingButton.replaceWith(roleButton(ctx, item));
      }
    });

    maybeAutoFeatureApprovedShare(ctx);
  }

  function applyLocalRole(ctx, message) {
    const role = String(message?.role || "audience");
    ctx.role = role;
    ctx.controllerUrl = message?.controllerUrl || "";

    const existing = ctx.root?.querySelector("[data-meeting-v2-cohost-control]");
    if (role !== "cohost" || !ctx.controllerUrl) {
      existing?.remove();
      return;
    }
    if (existing) {
      existing.dataset.controllerUrl = ctx.controllerUrl;
      return;
    }

    const dock = ctx.root?.querySelector(".live-media-actions");
    if (!dock) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "live-control-button meeting-v2-cohost-control";
    button.dataset.meetingV2CohostControl = "";
    button.dataset.controllerUrl = ctx.controllerUrl;
    button.innerHTML =
      '<span class="live-control-icon" aria-hidden="true">★</span>' +
      '<span data-live-control-label>Co-host</span>';
    button.title = "Open full co-host controller and interactive controls";
    button.addEventListener("click", () => {
      const url = new URL(button.dataset.controllerUrl, location.origin);
      window.open(url.href, "_blank", "noopener");
    });
    const leave = dock.querySelector("[data-live-leave]");
    if (leave) dock.insertBefore(button, leave);
    else dock.append(button);
  }

  function maybeAutoFeatureApprovedShare(ctx) {
    if (!ctx.isController || !ctx.preferredShareIdentity || !ctx.root) return;
    const figure = ctx.root.querySelector(
      `[data-live-screen-share-media] figure[data-participant-identity="${escapeSelector(ctx.preferredShareIdentity)}"]`
    );
    if (!figure) return;
    if (figure.classList.contains("is-featured")) {
      ctx.preferredShareIdentity = "";
      return;
    }
    const select = [...figure.querySelectorAll("button")].find(button =>
      /show .*screen to everyone/i.test(button.getAttribute("aria-label") || "")
    );
    if (select && !select.disabled) {
      ctx.preferredShareIdentity = "";
      select.click();
    }
  }

  function revokedOverlay(ctx, reason) {
    if (!ctx.isCohostController) return;
    ctx.session?.leave?.().catch?.(() => {});
    ctx.socket?.disconnect?.();
    if (document.querySelector(".meeting-v2-revoked-overlay")) return;
    const overlay = document.createElement("div");
    overlay.className = "meeting-v2-revoked-overlay";
    overlay.innerHTML = `<div><h2>Co-host access ended</h2><p></p></div>`;
    overlay.querySelector("p").textContent =
      reason === "session-ended"
        ? "The live meeting has ended. You can close this controller tab."
        : "The host removed your co-host permission. This controller can no longer change the meeting.";
    document.body.append(overlay);
    document.querySelectorAll("button,input,select,textarea").forEach(control => {
      control.disabled = true;
    });
  }

  function enhanceLiveMedia(value) {
    if (!value?.create || value.__meetingV2Enhanced) return value;
    const originalCreate = value.create.bind(value);
    value.create = function meetingV2Create(options) {
      const params = new URLSearchParams(location.search);
      const isCohostController = options.controller === true && params.get("cohost") === "1";
      const stableClientId = options.controller
        ? (isCohostController ? String(params.get("cohostGuestId") || "").slice(0, 128) : "")
        : stableGuestId();

      if (isCohostController) {
        document.body.dataset.meetingCohost = "1";
        const name = String(params.get("cohostName") || "").trim().slice(0, 80);
        if (name) options = { ...options, displayName: name };
      }

      const ctx = {
        presentationId: String(options.presentationId),
        root: options.root,
        options,
        socket: options.socket,
        isController: options.controller === true,
        isCohostController,
        stableClientId,
        ephemeralClientId: "",
        role: isCohostController ? "cohost" : "audience",
        controllerUrl: "",
        lastLobby: null,
        preferredShareIdentity: "",
        decorationTimers: [],
        session: null
      };
      contexts.set(ctx.presentationId, ctx);
      const onParticipantTilesRendered = options.onParticipantTilesRendered;

      const proxiedOptions = {
        ...options,
        socket: makeSocketProxy(ctx, options.socket),
        onParticipantTilesRendered: () => {
          onParticipantTilesRendered?.();
          decorateControllerParticipants(ctx);
        }
      };
      ctx.options = proxiedOptions;
      ctx.session = originalCreate(proxiedOptions);

      if (!ctx.isController) {
        options.socket?.on("meeting_role_changed", message => {
          if (
            message?.presentationId === ctx.presentationId &&
            String(message.clientId || "") === ctx.stableClientId
          ) {
            applyLocalRole(ctx, message);
          }
        });
      }

      // Do not use a MutationObserver here. This live-media root contains
      // participant tiles, attached media and presentation preview DOM. Watching
      // the whole subtree can create a feedback/render storm when a participant
      // connects. Co-host decoration is driven by lobby events instead.

      if (ctx.isCohostController) {
        options.socket?.on("meeting_controller_revoked", message => {
          if (
            message?.presentationId === ctx.presentationId &&
            String(message.clientId || "") === ctx.stableClientId
          ) revokedOverlay(ctx, message.reason);
        });
      }

      return ctx.session;
    };
    value.__meetingV2Enhanced = true;
    return value;
  }

  let liveMediaValue = window.SnapKeyLiveMedia;
  if (liveMediaValue) {
    window.SnapKeyLiveMedia = enhanceLiveMedia(liveMediaValue);
  } else {
    Object.defineProperty(window, "SnapKeyLiveMedia", {
      configurable: true,
      enumerable: true,
      get() {
        return liveMediaValue;
      },
      set(value) {
        liveMediaValue = enhanceLiveMedia(value);
      }
    });
  }
})();

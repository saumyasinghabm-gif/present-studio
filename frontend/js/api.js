(function () {
  const sessionKey = "presentStudio.session";
  const tokenKey = "presentStudio.accessToken";
  async function request(path, options = {}) {
    const token = localStorage.getItem(tokenKey);
    let response;
    try {
      response = await fetch(path, { credentials: "include", headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }, ...options });
    } catch { throw new Error("Backend not reachable. Start the FastAPI server and open http://127.0.0.1:8000."); }
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/signup")) {
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
    listPresentations: () => request("/api/presentations"), getPresentation: (id, token = "") => request(`/api/presentations/${encodeURIComponent(id)}${token ? `?token=${encodeURIComponent(token)}` : ""}`),
    createPresentation: (title) => request("/api/presentations", { method: "POST", body: JSON.stringify({ title }) }), savePresentation: (deck) => request(`/api/presentations/${encodeURIComponent(deck.id)}`, { method: "PUT", body: JSON.stringify(deck) }), deletePresentation: (id) => request(`/api/presentations/${encodeURIComponent(id)}`, { method: "DELETE" }),
    createShareLink: (id, permission = "viewer") => request(`/api/presentations/${encodeURIComponent(id)}/share`, { method: "POST", body: JSON.stringify({ permission }) }), getLiveSession: (id) => request(`/api/presentations/${encodeURIComponent(id)}/live`), setLiveSlide: (id, slideId, token = "") => request(`/api/presentations/${encodeURIComponent(id)}/live/slide${token ? `?token=${encodeURIComponent(token)}` : ""}`, { method: "POST", body: JSON.stringify({ slideId }) }), endLiveSession: (id) => request(`/api/presentations/${encodeURIComponent(id)}/live/end`, { method: "POST" }),
    listMedia: () => request("/api/media"), uploadMedia: (file) => { const form = new FormData(); form.append("file", file); return request("/api/media/upload", { method: "POST", body: form }); }
  };
})();

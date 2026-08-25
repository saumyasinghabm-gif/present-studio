(function () {
  const API_BASE = "";
  const sessionKey = "presentStudio.session";

  async function request(path, options = {}) {
    const token = window.localStorage.getItem("presentStudio.accessToken");
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {})
        },
        ...options
      });
    } catch {
      throw new Error("Backend not reachable. Start FastAPI and open http://127.0.0.1:8000/login.html");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.detail || body.error || `Request failed (${response.status}). Open the app through http://127.0.0.1:8000/login.html`);
    }
    return body;
  }

  window.PresentStudioApi = {
    async login(email, password) {
      const result = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      window.localStorage.setItem(sessionKey, JSON.stringify(result.user));
      window.localStorage.setItem("presentStudio.accessToken", result.accessToken);
      return result;
    },

    async signup(name, email, password) {
      const result = await request("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name, email, password })
      });
      window.localStorage.setItem(sessionKey, JSON.stringify(result.user));
      window.localStorage.setItem("presentStudio.accessToken", result.accessToken);
      return result;
    },

    async listPresentations() {
      return request("/api/presentations");
    },

    async getPresentation(id, token = "") {
      const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
      return request(`/api/presentations/${encodeURIComponent(id)}${suffix}`);
    },

    async createPresentation(title) {
      return request("/api/presentations", {
        method: "POST",
        body: JSON.stringify({ title })
      });
    },

    async savePresentation(presentation) {
      return request(`/api/presentations/${encodeURIComponent(presentation.id)}`, {
        method: "PUT",
        body: JSON.stringify(presentation)
      });
    },

    async createShareLink(id, permission = "viewer") {
      return request(`/api/presentations/${encodeURIComponent(id)}/share`, {
        method: "POST",
        body: JSON.stringify({ permission })
      });
    },

    async uploadMedia(file) {
      const token = window.localStorage.getItem("presentStudio.accessToken");
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/media/upload", {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || body.error || "Upload failed");
      return body;
    },

    async endLiveSession(id) {
      return request(`/api/presentations/${encodeURIComponent(id)}/live/end`, { method: "POST" });
    }
  };
})();

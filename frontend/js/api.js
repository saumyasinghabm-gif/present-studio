(function () {
  const API_BASE = "";
  const sessionKey = "presentStudio.session";

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || body.error || "Request failed");
    return body;
  }

  window.PresentStudioApi = {
    async login(email, password) {
      const result = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      window.localStorage.setItem(sessionKey, JSON.stringify(result.user));
      return result;
    },

    async listPresentations() {
      return request("/api/presentations");
    },

    async getPresentation(id) {
      return request(`/api/presentations/${encodeURIComponent(id)}`);
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

    async createShareLink(id) {
      return request(`/api/presentations/${encodeURIComponent(id)}/share`, { method: "POST" });
    }
  };
})();

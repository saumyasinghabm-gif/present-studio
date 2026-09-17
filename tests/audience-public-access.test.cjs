const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApi() {
  const requests = [];
  const storage = new Map([
    ["presentStudio.accessToken", "owner-access-token"],
    ["presentStudio.session", JSON.stringify({ name: "Studio Owner" })]
  ]);
  const source = fs.readFileSync(path.join(__dirname, "../frontend/js/api.js"), "utf8").split("/* MEETING_V2_BRIDGE")[0];
  const context = {
    FormData,
    JSON,
    URL,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    location: { pathname: "/join/viewer-token" },
    window: { location: { replace() {} } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ presentationId: "pres_test" }) };
    }
  };
  vm.runInNewContext(source, context);
  return { api: context.window.PresentStudioApi, requests };
}

test("public audience requests omit a logged-in owner's credentials", async () => {
  const { api, requests } = loadApi();

  await api.resolveShareLink("viewer-token", { publicAccess: true });
  await api.getPresentation("pres_test", "viewer-token", { publicAccess: true });
  await api.getLiveMediaToken("pres_test", { shareToken: "viewer-token" }, { publicAccess: true });

  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.headers.Authorization, undefined);
    assert.equal(request.options.publicAccess, undefined);
  }
});

test("normal authenticated requests keep the owner's credentials", async () => {
  const { api, requests } = loadApi();

  await api.getPresentation("pres_test");

  assert.equal(requests[0].options.credentials, "include");
  assert.equal(requests[0].options.headers.Authorization, "Bearer owner-access-token");
});

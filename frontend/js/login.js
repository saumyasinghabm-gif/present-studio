const form = document.querySelector("#loginForm");
const statusText = document.querySelector("#loginStatus");

if (new URLSearchParams(window.location.search).get("reason") === "session-expired") {
  statusText.textContent = "Your session expired. Sign in again to continue.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  statusText.textContent = "Signing in...";
  try {
    await window.PresentStudioApi.login(data.get("email"), data.get("password"));
    window.location.href = "/dashboard.html";
  } catch (error) {
    statusText.textContent = error.message;
  }
});

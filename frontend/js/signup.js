const signupForm = document.querySelector("#signupForm");
const signupStatus = document.querySelector("#signupStatus");
const signupButton = document.querySelector("#signupButton");
const passwordInput = document.querySelector("#password");
const passwordHint = document.querySelector("#passwordHint");

passwordInput.addEventListener("input", () => {
  const valid = passwordInput.value.length >= 8;
  passwordHint.textContent = valid ? "Password length looks good." : "Use at least 8 characters.";
  passwordHint.classList.toggle("is-valid", valid);
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(signupForm);
  const name = String(data.get("name") || "").trim();
  const email = String(data.get("email") || "").trim();
  const password = String(data.get("password") || "");
  const confirmation = String(data.get("confirmPassword") || "");
  if (name.length < 2) return void (signupStatus.textContent = "Enter your full name.");
  if (password.length < 8) return void (signupStatus.textContent = "Password must be at least 8 characters.");
  if (password !== confirmation) return void (signupStatus.textContent = "Passwords do not match.");
  signupButton.disabled = true;
  signupButton.textContent = "Creating workspace…";
  signupStatus.textContent = "Setting up your account…";
  try {
    await window.PresentStudioApi.signup(name, email, password);
    window.location.href = "/dashboard.html";
  } catch (error) {
    signupStatus.textContent = error.message;
    signupButton.disabled = false;
    signupButton.textContent = "Create workspace";
  }
});

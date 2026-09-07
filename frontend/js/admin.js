const api = window.PresentStudioApi;
const usersTable = document.querySelector("#usersTable");
const searchInput = document.querySelector("#userSearch");
const refreshButton = document.querySelector("#refreshUsers");
const builderButton = document.querySelector("#builderNav");
const toast = document.querySelector("#toast");

let adminUsers = [];
let toastTimer = null;
let currentAdminId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

function initials(name) {
  return String(name || "User").trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = -1;
  do { amount /= 1024; unit += 1; } while (amount >= 1024 && unit < units.length - 1);
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unit]}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function usagePercent(used, limit) {
  if (!limit) return used ? 100 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function filteredUsers() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return adminUsers;
  return adminUsers.filter(user => `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(query));
}

function renderUsers(users) {
  if (!users.length) {
    usersTable.innerHTML = `<tr><td colspan="6" class="admin-table-status">No matching users found.</td></tr>`;
    return;
  }

  usersTable.innerHTML = users.map(user => {
    const presentationPercent = usagePercent(user.presentationUsed, user.presentationLimit);
    const storageUnlimited = user.storageLimitBytes === null;
    const storagePercent = storageUnlimited ? 0 : usagePercent(user.storageUsedBytes, user.storageLimitBytes);
    const presentationFull = user.presentationUsed >= user.presentationLimit;
    const storageOver = user.storageOverageBytes > 0;
    const storageLimitMb = storageUnlimited ? 0 : Math.round(user.storageLimitBytes / (1024 * 1024));
    const storageUsedMb = Math.ceil(user.storageUsedBytes / (1024 * 1024));
    const storageSliderMax = Math.min(1048576, Math.max(1024, storageLimitMb * 2, storageUsedMb * 2));
    const isCurrentAdmin = user.id === currentAdminId;
    return `<tr data-user-id="${escapeHtml(user.id)}">
      <td><div class="admin-user"><span class="admin-avatar">${escapeHtml(initials(user.name))}</span><div><strong>${escapeHtml(user.name)}</strong><small title="${escapeHtml(user.email)}">${escapeHtml(user.email)}</small></div></div></td>
      <td><span class="status-badge ${user.role === "admin" ? "admin" : ""} ${user.isActive ? "" : "inactive"}"><i class="bi ${user.role === "admin" ? "bi-shield-check" : "bi-person"}"></i>${escapeHtml(user.role)}${user.isActive ? "" : " · inactive"}</span></td>
      <td class="usage-cell"><div class="usage-line"><strong>${user.presentationUsed} / ${user.presentationLimit}</strong><span>${user.presentationRemaining} remaining</span></div><div class="usage-bar ${presentationFull ? "is-full" : ""}" role="progressbar" aria-valuenow="${presentationPercent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${presentationPercent}%"></span></div></td>
      <td class="usage-cell storage-cell"><div class="usage-line"><strong>${formatBytes(user.storageUsedBytes)}</strong><span>${storageUnlimited ? "Unlimited" : `of ${formatBytes(user.storageLimitBytes)}`}</span></div><div class="usage-bar ${storageOver ? "is-over" : ""}" role="progressbar" aria-valuenow="${storagePercent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${storagePercent}%"></span></div><span class="storage-status ${storageOver ? "overage" : ""}">${storageUnlimited ? "No limit assigned" : (storageOver ? `${formatBytes(user.storageOverageBytes)} over limit` : `${formatBytes(user.storageRemainingBytes)} available`)}</span><form class="storage-limit-editor" data-storage-limit-form="${escapeHtml(user.id)}"><input class="storage-limit-slider" type="range" min="0" max="${storageSliderMax}" step="1" value="${storageLimitMb}" aria-label="Adjust media storage limit for ${escapeHtml(user.name)}" ${storageUnlimited ? "disabled" : ""}><div class="storage-limit-exact"><input class="storage-limit-number" type="number" min="0" max="1048576" step="1" value="${storageUnlimited ? "" : storageLimitMb}" placeholder="Unlimited" aria-label="Exact media storage limit in MB for ${escapeHtml(user.name)}" ${storageUnlimited ? "disabled" : ""}><span>MB</span><label><input class="storage-unlimited" type="checkbox" ${storageUnlimited ? "checked" : ""}> Unlimited</label><button type="submit"><i class="bi bi-check2"></i> Save</button></div></form></td>
      <td><form class="limit-editor" data-limit-form="${escapeHtml(user.id)}"><input class="limit-number" type="number" min="0" max="100000" step="1" value="${user.presentationLimit}" aria-label="Presentation limit for ${escapeHtml(user.name)}" required><button type="submit"><i class="bi bi-check2"></i> Save</button></form></td>
      <td><button class="revoke-user" type="button" data-revoke-user="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.name)}" ${isCurrentAdmin ? "disabled" : ""}><i class="bi bi-person-x"></i>${isCurrentAdmin ? "Current admin" : "Revoke"}</button></td>
    </tr>`;
  }).join("");

  usersTable.querySelectorAll("[data-limit-form]").forEach(form => form.addEventListener("submit", updateLimit));
  usersTable.querySelectorAll("[data-storage-limit-form]").forEach(form => {
    const slider = form.querySelector(".storage-limit-slider");
    const number = form.querySelector(".storage-limit-number");
    const unlimited = form.querySelector(".storage-unlimited");
    slider.addEventListener("input", () => { number.value = slider.value; });
    number.addEventListener("input", () => {
      if (Number(number.value) > Number(slider.max)) slider.max = String(Math.min(1048576, Number(number.value)));
      slider.value = number.value;
    });
    unlimited.addEventListener("change", () => {
      slider.disabled = unlimited.checked;
      number.disabled = unlimited.checked;
      if (!unlimited.checked && !number.value) {
        const user = adminUsers.find(item => item.id === form.dataset.storageLimitForm);
        number.value = String(Math.max(200, Math.ceil((user?.storageUsedBytes || 0) / (1024 * 1024))));
        slider.value = number.value;
      }
    });
    form.addEventListener("submit", updateStorageLimit);
  });
  usersTable.querySelectorAll("[data-revoke-user]").forEach(button => button.addEventListener("click", revokeUser));
}

function renderSummary(summary) {
  document.querySelector("#totalUsers").textContent = summary.totalUsers.toLocaleString();
  document.querySelector("#activeUsers").textContent = `${summary.activeUsers.toLocaleString()} active`;
  document.querySelector("#totalPresentations").textContent = summary.totalPresentations.toLocaleString();
  document.querySelector("#totalStorage").textContent = formatBytes(summary.totalStorageBytes);
  document.querySelector("#overageUsers").textContent = summary.overageUsers.toLocaleString();
}

async function updateLimit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.querySelector(".limit-number");
  const button = form.querySelector("button");
  const limit = Number(input.value);
  if (!Number.isInteger(limit) || limit < 0 || limit > 100000) {
    showToast("Enter a whole-number limit from 0 to 100,000.");
    return;
  }

  button.disabled = true;
  try {
    const result = await api.updatePresentationLimit(form.dataset.limitForm, limit);
    const index = adminUsers.findIndex(user => user.id === result.user.id);
    if (index >= 0) adminUsers[index] = result.user;
    renderUsers(filteredUsers());
    showToast(`Presentation limit updated to ${limit}.`);
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

async function updateStorageLimit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const number = form.querySelector(".storage-limit-number");
  const unlimited = form.querySelector(".storage-unlimited");
  const button = form.querySelector("button");
  const limitMb = unlimited.checked ? null : Number(number.value);
  if (limitMb !== null && (!Number.isInteger(limitMb) || limitMb < 0 || limitMb > 1048576)) {
    showToast("Enter a whole-number storage limit from 0 to 1,048,576 MB.");
    return;
  }

  button.disabled = true;
  try {
    const limitBytes = limitMb === null ? null : limitMb * 1024 * 1024;
    const result = await api.updateStorageLimit(form.dataset.storageLimitForm, limitBytes);
    const index = adminUsers.findIndex(user => user.id === result.user.id);
    if (index >= 0) adminUsers[index] = result.user;
    renderUsers(filteredUsers());
    showToast(limitMb === null ? "Media storage set to unlimited." : `Media storage limit updated to ${limitMb} MB.`);
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

async function revokeUser(event) {
  const button = event.currentTarget;
  const userId = button.dataset.revokeUser;
  const userName = button.dataset.userName || "this user";
  if (!window.confirm(`Revoke ${userName}? This permanently removes the account and all presentations owned by it.`)) return;

  button.disabled = true;
  try {
    await api.revokeUser(userId);
    showToast(`${userName} was revoked.`);
    await loadUsers();
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

async function loadUsers() {
  refreshButton.disabled = true;
  try {
    const result = await api.listAdminUsers();
    adminUsers = result.users;
    renderSummary(result.summary);
    renderUsers(filteredUsers());
  } catch (error) {
      usersTable.innerHTML = `<tr><td colspan="6" class="admin-table-status error">${escapeHtml(error.message)}</td></tr>`;
  } finally {
    refreshButton.disabled = false;
  }
}

async function initialize() {
  try {
    const { user } = await api.getCurrentUser();
    if (user.role !== "admin") {
      window.location.replace("/dashboard.html");
      return;
    }
    currentAdminId = user.id;
    document.querySelector("#profileInitials").textContent = initials(user.name);
    await loadUsers();
  } catch (error) {
    if (!/session expired/i.test(error.message || "")) window.location.replace("/login.html");
  }
}

searchInput.addEventListener("input", () => renderUsers(filteredUsers()));
refreshButton.addEventListener("click", loadUsers);
builderButton.addEventListener("click", async () => {
  builderButton.disabled = true;
  try {
    const { presentations } = await api.listPresentations();
    if (presentations.length) {
      window.location.href = `/builder.html?id=${encodeURIComponent(presentations[0].id)}`;
      return;
    }
    const { presentation } = await api.createPresentation("Untitled presentation");
    window.location.href = `/builder.html?id=${encodeURIComponent(presentation.id)}`;
  } catch (error) {
    builderButton.disabled = false;
    showToast(error.message);
  }
});
document.querySelector("#profileButton").addEventListener("click", async () => {
  if (!window.confirm("Sign out of SnapKey Studio?")) return;
  try { await api.logout(); } catch (error) { /* Continue to login even if logout fails. */ }
  window.location.href = "/login.html";
});

initialize();

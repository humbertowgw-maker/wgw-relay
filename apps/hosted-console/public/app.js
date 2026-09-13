let adminToken = sessionStorage.getItem("wgw-relay-admin") || "";
let state = null;
let selectedConversationId = null;
let activeView = "inbox";

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function setNotice(message = "") {
  const notice = $("#notice");
  notice.hidden = !message;
  notice.textContent = message;
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}), "x-relay-admin": adminToken };
  const response = await fetch(path, { ...options, headers });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.error || "That action did not finish");
  return payload;
}

async function refresh() {
  state = await api("/api/state");
  if (state.conversations.length && !state.conversations.some((item) => item.id === selectedConversationId)) selectedConversationId = state.conversations[0].id;
  render();
}

function show(screen) {
  ["unlock", "onboarding", "dashboard"].forEach((id) => { $(`#${id}`).hidden = id !== screen; });
}

function statusClass(value) {
  return value === "ready" ? "ready" : value === "awaiting_first_heartbeat" ? "warn" : "";
}

function conversationCard(conversation) {
  const last = conversation.messages.at(-1);
  return `<li><button class="conversation ${conversation.id === selectedConversationId ? "active" : ""}" data-select-conversation="${escapeHtml(conversation.id)}">
    <span class="conversation-title"><span>${escapeHtml(conversation.customerPhone)}</span><span class="pill ${conversation.optedOut ? "warn" : ""}">${conversation.optedOut ? "Opted out" : escapeHtml(conversation.ownerExtension || "Unassigned")}</span></span>
    <span class="conversation-preview">${escapeHtml(last?.body || "No messages yet")}</span>
  </button></li>`;
}

function inboxView() {
  const conversation = state.conversations.find((item) => item.id === selectedConversationId);
  const unassigned = state.conversations.filter((item) => !item.ownerId && !item.optedOut).length;
  const ready = state.gateways.filter((item) => item.state === "ready").length;
  return `<div class="stats">
    <div class="card"><span class="muted">Needs assignment</span><strong class="stat-value">${unassigned}</strong></div>
    <div class="card"><span class="muted">Relay phones ready</span><strong class="stat-value">${ready}/${state.gateways.length}</strong></div>
    <div class="card"><span class="muted">Private conversations</span><strong class="stat-value">${state.conversations.length}</strong></div>
  </div>
  <div class="split">
    <section><div class="section-head"><h2>Inbox</h2><span class="muted">Only the assigned owner should work a thread.</span></div>
      ${state.conversations.length ? `<ul class="list">${state.conversations.map(conversationCard).join("")}</ul>` : `<div class="card empty">Messages will appear here when your paired Relay phone checks in.</div>`}
    </section>
    <section class="card">${conversation ? detailView(conversation) : `<p class="empty">Select a conversation to review it.</p>`}</section>
  </div>`;
}

function detailView(conversation) {
  const ownerOptions = state.employees.map((employee) => `<option value="${escapeHtml(employee.id)}" ${employee.id === conversation.ownerId ? "selected" : ""}>${escapeHtml(employee.name)} · ext ${escapeHtml(employee.extension)}</option>`).join("");
  const messages = conversation.messages.map((message) => `<article class="message ${message.direction}"><span>${escapeHtml(message.body)}</span><small>${escapeHtml(message.status)} · ${new Date(message.at).toLocaleString()}</small></article>`).join("");
  return `<div class="detail-head"><div><p class="eyebrow">CUSTOMER</p><h2>${escapeHtml(conversation.customerPhone)}</h2><span class="pill ${conversation.optedOut ? "warn" : ""}">${conversation.optedOut ? "Opted out — sending locked" : escapeHtml(conversation.ownerName ? `Owned by ${conversation.ownerName}` : "Needs owner")}</span></div>
    <button class="danger" data-opt-out="${escapeHtml(conversation.id)}">${conversation.optedOut ? "Restore texting" : "Mark opted out"}</button></div>
    <div class="detail-actions"><label>Conversation owner<select id="owner-select">${ownerOptions}</select></label><button data-assign="${escapeHtml(conversation.id)}">Assign</button></div>
    <div class="messages">${messages || `<p class="empty">No messages yet.</p>`}</div>
    <form class="reply" data-reply="${escapeHtml(conversation.id)}"><label>Reply from ${escapeHtml(conversation.businessPhone)}<textarea name="body" placeholder="Write a reply that will send from the business number" ${conversation.optedOut ? "disabled" : ""} required></textarea></label><button type="submit" ${conversation.optedOut ? "disabled" : ""}>Queue reply for Relay phone</button></form>`;
}

function peopleView() {
  const employees = state.employees.map((employee) => `<li class="card row"><span><strong>${escapeHtml(employee.name)}</strong><br><span class="muted">Extension ${escapeHtml(employee.extension)} · ${escapeHtml(employee.role)}</span></span><span class="pill ${employee.alertEnabled ? "ready" : ""}">${employee.alertEnabled ? "Personal alert enabled" : "Inbox only"}</span></li>`).join("");
  return `<div class="split"><section><div class="section-head"><h2>People</h2><span class="muted">Extensions are internal IDs, not customer-facing numbers.</span></div><ul class="list">${employees}</ul></section>
    <section class="card"><p class="eyebrow">ADD A TEAM MEMBER</p><h2>Give them an extension</h2><form id="employee-form" class="form-grid"><label>Name<input name="name" required></label><label>Extension<input name="extension" inputmode="numeric" placeholder="101" required></label><label class="wide">Optional personal alert number<input name="alertPhone" inputmode="tel" placeholder="+15551234567"></label><label class="wide"><input name="alertEnabled" type="checkbox"> Send an alert to this number for important conversations</label><button class="wide" type="submit">Add employee</button></form></section></div>`;
}

function phoneView() {
  const phones = state.gateways.map((gateway) => `<li class="card row"><span><strong>${escapeHtml(gateway.label)}</strong><br><span class="muted">${escapeHtml(gateway.phoneNumber)} · last seen ${gateway.lastHeartbeatAt ? new Date(gateway.lastHeartbeatAt).toLocaleString() : "never"}</span></span><span class="pill ${statusClass(gateway.state)}">${escapeHtml(gateway.state.replaceAll("_", " "))}</span></li>`).join("");
  return `<div class="split"><section><div class="section-head"><h2>Relay phones</h2><span class="muted">One real SIM is the customer-visible number.</span></div>${phones ? `<ul class="list">${phones}</ul>` : `<div class="card empty">Pair the dedicated business phone when the native gateway is ready.</div>`}
    <div class="section-head"><h2>Recent activity</h2></div><ul class="audit">${state.audit.slice(0, 8).map((item) => `<li>${escapeHtml(new Date(item.at).toLocaleString())} · ${escapeHtml(item.action.replaceAll(".", " "))}</li>`).join("") || "<li>No activity yet.</li>"}</ul></section>
    <section class="card"><p class="eyebrow">PAIR A PHONE</p><h2>Create a one-time gateway credential</h2><p class="muted">Give this only to the native app running on the dedicated business phone. It is not an employee extension and it is never shown again after this page is closed.</p><form id="gateway-form" class="stack"><label>Phone name<input name="label" placeholder="Front desk iPhone" required></label><label>SIM number<input name="phoneNumber" value="${escapeHtml(state.tenant.mainNumber)}" inputmode="tel" required></label><button type="submit">Create pairing credential</button></form><div id="pairing-result"></div></section></div>`;
}

function render() {
  if (!state?.configured) return show("onboarding");
  show("dashboard");
  $("#organization-name").textContent = state.tenant.organizationName;
  $("#business-number").textContent = `Customer-visible number: ${state.tenant.mainNumber}`;
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView));
  $("#view").innerHTML = activeView === "people" ? peopleView() : activeView === "phone" ? phoneView() : inboxView();
}

$("#unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminToken = $("#access-key").value;
  try {
    await refresh();
    sessionStorage.setItem("wgw-relay-admin", adminToken);
    setNotice();
  } catch (error) {
    adminToken = "";
    setNotice(error.message);
  }
});

$("#onboarding-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/onboarding", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    await refresh();
    setNotice("Relay created. Next: add a teammate or pair the business phone.");
  } catch (error) { setNotice(error.message); }
});

document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-view]");
  if (tab) { activeView = tab.dataset.view; render(); return; }
  if (event.target.id === "refresh") { try { await refresh(); setNotice("Console refreshed."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "lock") { sessionStorage.removeItem("wgw-relay-admin"); adminToken = ""; state = null; show("unlock"); return; }
  const select = event.target.closest("[data-select-conversation]");
  if (select) { selectedConversationId = select.dataset.selectConversation; render(); return; }
  const assign = event.target.closest("[data-assign]");
  if (assign) { try { await api(`/api/conversations/${assign.dataset.assign}/assignment`, { method: "POST", body: JSON.stringify({ employeeId: $("#owner-select").value }) }); await refresh(); setNotice("Conversation owner updated."); } catch (error) { setNotice(error.message); } return; }
  const optOut = event.target.closest("[data-opt-out]");
  if (optOut) { const conversation = state.conversations.find((item) => item.id === optOut.dataset.optOut); try { await api(`/api/conversations/${optOut.dataset.optOut}/opt-out`, { method: "POST", body: JSON.stringify({ optedOut: !conversation.optedOut }) }); await refresh(); setNotice(conversation.optedOut ? "Texting restored." : "Customer marked opted out; sending is locked."); } catch (error) { setNotice(error.message); } }
});

document.addEventListener("submit", async (event) => {
  const reply = event.target.closest("[data-reply]");
  if (reply) { event.preventDefault(); try { await api(`/api/conversations/${reply.dataset.reply}/reply`, { method: "POST", body: JSON.stringify({ body: new FormData(reply).get("body") }) }); await refresh(); setNotice("Reply queued for the Relay phone."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "employee-form") { event.preventDefault(); const form = new FormData(event.target); try { await api("/api/employees", { method: "POST", body: JSON.stringify({ ...Object.fromEntries(form), alertEnabled: form.get("alertEnabled") === "on" }) }); await refresh(); setNotice("Employee added."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "gateway-form") { event.preventDefault(); try { const paired = await api("/api/gateways", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); await refresh(); const result = $("#pairing-result"); if (result) result.innerHTML = `<div class="key">Copy this into the native Relay app now. It cannot be recovered.<code>${escapeHtml(paired.gateway.id)}:${escapeHtml(paired.pairingToken)}</code></div>`; setNotice("Pairing credential created."); } catch (error) { setNotice(error.message); } }
});

(async () => {
  try {
    const status = await fetch("/api/status").then((response) => response.json());
    if (!adminToken) return show("unlock");
    await refresh();
    if (!status.configured) show("onboarding");
  } catch {
    sessionStorage.removeItem("wgw-relay-admin");
    adminToken = "";
    show("unlock");
  }
})();

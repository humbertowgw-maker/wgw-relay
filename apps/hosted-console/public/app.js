let sessionToken = sessionStorage.getItem("wgw-relay-session") || "";
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
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}), ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.error || "That action did not finish");
  return payload;
}

function show(screen) {
  ["auth", "phone-onboarding", "dashboard"].forEach((id) => { $(`#${id}`).hidden = id !== screen; });
}

async function establishSession(result) {
  sessionToken = result.sessionToken;
  sessionStorage.setItem("wgw-relay-session", sessionToken);
  await refresh();
}

async function refresh() {
  state = await api("/api/state");
  if (state.conversations.length && !state.conversations.some((item) => item.id === selectedConversationId)) selectedConversationId = state.conversations[0].id;
  render();
}

function statusClass(value) { return value === "ready" ? "ready" : value === "awaiting_first_heartbeat" ? "warn" : ""; }

function conversationCard(conversation) {
  const last = conversation.messages.at(-1);
  return `<li><button class="conversation ${conversation.id === selectedConversationId ? "active" : ""}" data-select-conversation="${escapeHtml(conversation.id)}"><span class="conversation-title"><span>${escapeHtml(conversation.customerPhone)}</span><span class="pill ${conversation.optedOut ? "warn" : ""}">${conversation.optedOut ? "Opted out" : escapeHtml(conversation.ownerExtension || "Unassigned")}</span></span><span class="conversation-preview">${escapeHtml(last?.body || "No messages yet")}</span></button></li>`;
}

function detailView(conversation) {
  const assignment = state.permissions.manageInbox
    ? `<div class="detail-actions"><label>Conversation owner<select id="owner-select">${state.members.map((member) => `<option value="${escapeHtml(member.id)}" ${member.id === conversation.ownerId ? "selected" : ""}>${escapeHtml(member.name)} · ext ${escapeHtml(member.extension)}</option>`).join("")}</select></label><button data-assign="${escapeHtml(conversation.id)}">Assign</button></div>`
    : `<p class="muted">Assigned to ${escapeHtml(conversation.ownerName || "your team")}</p>`;
  const messages = conversation.messages.map((message) => `<article class="message ${message.direction}"><span>${escapeHtml(message.body)}</span><small>${escapeHtml(message.status)} · ${new Date(message.at).toLocaleString()}</small></article>`).join("");
  return `<div class="detail-head"><div><p class="eyebrow">CUSTOMER</p><h2>${escapeHtml(conversation.customerPhone)}</h2><span class="pill ${conversation.optedOut ? "warn" : ""}">${conversation.optedOut ? "Opted out — sending locked" : escapeHtml(conversation.ownerName ? `Owned by ${conversation.ownerName}` : "Needs owner")}</span></div><button class="danger" data-opt-out="${escapeHtml(conversation.id)}">${conversation.optedOut ? "Restore texting" : "Mark opted out"}</button></div>${assignment}<div class="messages">${messages || `<p class="empty">No messages yet.</p>`}</div><form class="reply" data-reply="${escapeHtml(conversation.id)}"><label>Reply from ${escapeHtml(conversation.businessPhone)}<textarea name="body" placeholder="Write a reply that will send from the business number" ${conversation.optedOut ? "disabled" : ""} required></textarea></label><button type="submit" ${conversation.optedOut ? "disabled" : ""}>Queue reply for Relay phone</button></form>`;
}

function inboxView() {
  const conversation = state.conversations.find((item) => item.id === selectedConversationId);
  const unassigned = state.permissions.manageInbox ? state.conversations.filter((item) => !item.ownerId && !item.optedOut).length : 0;
  return `<div class="stats"><div class="card"><span class="muted">${state.permissions.manageInbox ? "Needs assignment" : "My conversations"}</span><strong class="stat-value">${state.permissions.manageInbox ? unassigned : state.conversations.length}</strong></div><div class="card"><span class="muted">Visible to you</span><strong class="stat-value">${state.conversations.length}</strong></div><div class="card"><span class="muted">Business number</span><strong class="stat-value smaller">${escapeHtml(state.tenant.mainNumber)}</strong></div></div><div class="split"><section><div class="section-head"><h2>Inbox</h2><span class="muted">${state.permissions.manageInbox ? "Assign a thread before replying." : "You see only conversations assigned to you."}</span></div>${state.conversations.length ? `<ul class="list">${state.conversations.map(conversationCard).join("")}</ul>` : `<div class="card empty">No conversations are assigned to you yet.</div>`}</section><section class="card">${conversation ? detailView(conversation) : `<p class="empty">Select a conversation to review it.</p>`}</section></div>`;
}

function teamView() {
  const members = state.members.map((member) => `<li class="card row"><span><strong>${escapeHtml(member.name)}</strong><br><span class="muted">Extension ${escapeHtml(member.extension)} · ${escapeHtml(member.role)}${state.permissions.managePeople ? ` · ${escapeHtml(member.email)}` : ""}</span></span><span class="pill ${member.alertEnabled ? "ready" : ""}">${member.alertEnabled ? "Personal alert enabled" : "Inbox only"}</span></li>`).join("");
  const invite = state.permissions.managePeople ? `<section class="card"><p class="eyebrow">INVITE A TEAMMATE</p><h2>Give them their own secure inbox</h2><form id="invite-team-form" class="form-grid"><label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Extension<input name="extension" inputmode="numeric" placeholder="101" required></label><label>Role<select name="role"><option value="agent">Agent — assigned inbox only</option><option value="manager">Manager — team inbox and assignments</option></select></label><button class="wide" type="submit">Create invite</button></form><div id="invite-result"></div></section>` : `<section class="card"><p class="eyebrow">YOUR ACCESS</p><h2>Private by default</h2><p class="muted">Your team lead manages membership. You only see the conversations assigned to your extension.</p></section>`;
  return `<div class="split"><section><div class="section-head"><h2>Team</h2><span class="muted">Extensions are internal IDs, never customer-facing numbers.</span></div><ul class="list">${members}</ul></section>${invite}</div>`;
}

function phoneView() {
  if (!state.permissions.manageGateway) return `<section class="card"><p class="eyebrow">RELAY PHONE</p><h2>Owner-controlled</h2><p class="muted">The organization owner pairs and monitors the dedicated business phone. Team members never need the pairing credential.</p></section>`;
  const phones = state.gateways.map((gateway) => `<li class="card row"><span><strong>${escapeHtml(gateway.label)}</strong><br><span class="muted">${escapeHtml(gateway.phoneNumber)} · last seen ${gateway.lastHeartbeatAt ? new Date(gateway.lastHeartbeatAt).toLocaleString() : "never"}</span></span><span class="pill ${statusClass(gateway.state)}">${escapeHtml(gateway.state.replaceAll("_", " "))}</span></li>`).join("");
  const plan = state.tenant.phoneSetup;
  const services = [[plan.callsEnabled, "Calls forward to", plan.callForwardNumber || "not configured"], [plan.textsEnabled, "Texts", "secure inbox"], [plan.voicemailEnabled, "Voicemail", "saved and alerted"]].filter(([enabled]) => enabled).map(([, label, value]) => `<li>${escapeHtml(label)}: <strong>${escapeHtml(value)}</strong></li>`).join("");
  return `<div class="split"><section><div class="section-head"><h2>Relay phones</h2><span class="muted">The real SIM remains the customer-visible number.</span></div><div class="card"><p class="eyebrow">YOUR NUMBER PLAN</p><h3>${escapeHtml(state.tenant.mainNumber)}</h3><ul class="audit">${services}</ul><p class="muted">Saved and ready to connect to the Relay phone or PBX. Calls and voicemail do not activate until that connection is live.</p></div>${phones ? `<ul class="list">${phones}</ul>` : `<div class="card empty">Pair the dedicated business phone when the native gateway is ready.</div>`}<div class="section-head"><h2>Recent activity</h2></div><ul class="audit">${state.audit.slice(0, 8).map((item) => `<li>${escapeHtml(new Date(item.at).toLocaleString())} · ${escapeHtml(item.action.replaceAll(".", " "))}</li>`).join("") || "<li>No activity yet.</li>"}</ul></section><section class="card"><p class="eyebrow">PAIR A PHONE</p><h2>Create a one-time gateway credential</h2><p class="muted">Give this only to the native app on the dedicated business phone. It is not an employee extension.</p><form id="gateway-form" class="stack"><label>Phone name<input name="label" placeholder="Front desk phone" required></label><label>SIM number<input name="phoneNumber" value="${escapeHtml(state.tenant.mainNumber)}" inputmode="tel" required></label><button type="submit">Create pairing credential</button></form><div id="pairing-result"></div></section></div>`;
}

function profileView() {
  const viewer = state.viewer;
  return `<div class="split"><section class="card"><p class="eyebrow">MY PROFILE</p><h2>${escapeHtml(viewer.name)}</h2><p class="muted">${escapeHtml(viewer.email)} · ${escapeHtml(viewer.role)} · extension ${escapeHtml(viewer.extension)}</p><form id="profile-form" class="stack"><label>Your name<input name="name" value="${escapeHtml(viewer.name)}" required></label><label>Personal alert number<input name="personalPhone" inputmode="tel" placeholder="${viewer.alertPhoneConfigured ? "Configured — enter a new number to replace it" : "+15551234567"}"></label><label><input name="alertEnabled" type="checkbox" ${viewer.alertEnabled ? "checked" : ""}> Send important alerts to my personal number</label><button type="submit">Save my preferences</button></form></section><section class="card"><p class="eyebrow">HOW ACCESS WORKS</p><h2>Simple and private</h2><p class="muted">Your extension is your internal identity. Customers see the business number. Your personal number is used only for alerts if you enable it, never as the customer-facing sender.</p></section></div>`;
}

function render() {
  if (!state) return show("auth");
  if (!state.tenant.phoneSetup?.completedAt) return show("phone-onboarding");
  show("dashboard");
  $("#organization-name").textContent = state.tenant.organizationName;
  $("#business-number").textContent = `Customer-visible number: ${state.tenant.mainNumber}`;
  $("#viewer-role").textContent = `${state.viewer.name.toUpperCase()} · ${state.viewer.role.toUpperCase()} · EXT ${state.viewer.extension}`;
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView));
  $("#view").innerHTML = activeView === "team" ? teamView() : activeView === "phone" ? phoneView() : activeView === "profile" ? profileView() : inboxView();
}

async function handleAuth(event, endpoint) {
  event.preventDefault();
  try { await establishSession(await api(endpoint, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) })); setNotice(); } catch (error) { setNotice(error.message); }
}

$("#login-form").addEventListener("submit", (event) => handleAuth(event, "/api/login"));
$("#register-form").addEventListener("submit", (event) => handleAuth(event, "/api/register"));
$("#invite-form").addEventListener("submit", (event) => handleAuth(event, "/api/invitations/accept"));
$("#phone-setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = {
    businessNumber: form.get("businessNumber"),
    businessPurpose: form.get("businessPurpose"),
    callsEnabled: form.get("callsEnabled") === "on",
    textsEnabled: form.get("textsEnabled") === "on",
    voicemailEnabled: form.get("voicemailEnabled") === "on",
    callForwardNumber: form.get("callForwardNumber"),
    notificationPhone: form.get("notificationPhone"),
  };
  try { await api("/api/phone-setup", { method: "POST", body: JSON.stringify(body) }); await refresh(); setNotice("Your number plan is saved. Pair the Relay phone when it is ready."); } catch (error) { setNotice(error.message); }
});

document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-view]");
  if (tab) { activeView = tab.dataset.view; render(); return; }
  if (event.target.id === "refresh") { try { await refresh(); setNotice("Inbox refreshed."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "logout") { try { await api("/api/logout", { method: "POST" }); } finally { sessionStorage.removeItem("wgw-relay-session"); sessionToken = ""; state = null; selectedConversationId = null; show("auth"); } return; }
  const select = event.target.closest("[data-select-conversation]");
  if (select) { selectedConversationId = select.dataset.selectConversation; render(); return; }
  const assign = event.target.closest("[data-assign]");
  if (assign) { try { await api(`/api/conversations/${assign.dataset.assign}/assignment`, { method: "POST", body: JSON.stringify({ userId: $("#owner-select").value }) }); await refresh(); setNotice("Conversation owner updated."); } catch (error) { setNotice(error.message); } return; }
  const optOut = event.target.closest("[data-opt-out]");
  if (optOut) { const conversation = state.conversations.find((item) => item.id === optOut.dataset.optOut); try { await api(`/api/conversations/${optOut.dataset.optOut}/opt-out`, { method: "POST", body: JSON.stringify({ optedOut: !conversation.optedOut }) }); await refresh(); setNotice(conversation.optedOut ? "Texting restored." : "Customer marked opted out; sending is locked."); } catch (error) { setNotice(error.message); } }
});

document.addEventListener("submit", async (event) => {
  const reply = event.target.closest("[data-reply]");
  if (reply) { event.preventDefault(); try { await api(`/api/conversations/${reply.dataset.reply}/reply`, { method: "POST", body: JSON.stringify({ body: new FormData(reply).get("body") }) }); await refresh(); setNotice("Reply queued for the Relay phone."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "invite-team-form") { event.preventDefault(); try { const result = await api("/api/invitations", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); await refresh(); const output = $("#invite-result"); if (output) output.innerHTML = `<div class="key">Give this code only to ${escapeHtml(result.invitation.email)}. It expires ${escapeHtml(new Date(result.invitation.expiresAt).toLocaleDateString())}.<code>${escapeHtml(result.inviteCode)}</code></div>`; setNotice("Invite created."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "gateway-form") { event.preventDefault(); try { const paired = await api("/api/gateways", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); await refresh(); const output = $("#pairing-result"); if (output) output.innerHTML = `<div class="key">Copy this into the native Relay app now. It cannot be recovered.<code>${escapeHtml(paired.gateway.id)}:${escapeHtml(paired.pairingToken)}</code></div>`; setNotice("Pairing credential created."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "profile-form") { event.preventDefault(); const form = new FormData(event.target); const body = { name: form.get("name"), alertEnabled: form.get("alertEnabled") === "on" }; if (form.get("personalPhone")) body.personalPhone = form.get("personalPhone"); try { await api("/api/profile", { method: "POST", body: JSON.stringify(body) }); await refresh(); setNotice("Your preferences are saved."); } catch (error) { setNotice(error.message); } }
});

(async () => {
  if (!sessionToken) return show("auth");
  try { await refresh(); } catch { sessionStorage.removeItem("wgw-relay-session"); sessionToken = ""; state = null; show("auth"); }
})();

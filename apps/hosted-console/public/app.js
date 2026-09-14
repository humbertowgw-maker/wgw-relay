let sessionToken = sessionStorage.getItem("wgw-relay-session") || "";
let state = null;
let selectedConversationId = null;
let activeView = "inbox";
let authMode = "sign-in";

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

function setAuthMode(mode) {
  const content = {
    "sign-in": ["Welcome back", "Sign in to your private business inbox."],
    create: ["Create your Relay", "Start with your owner account. The phone number comes next."],
    join: ["Join your team", "Use the invite code from your organization owner."],
  }[mode];
  if (!content) return;
  authMode = mode;
  $("#auth-title").textContent = content[0];
  $("#auth-copy").textContent = content[1];
  document.querySelectorAll("[data-auth-form]").forEach((form) => { form.hidden = form.dataset.authForm !== mode; });
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    const selected = button.dataset.authMode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
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
  const routes = state.permissions.manageRouting ? `<section class="card"><p class="eyebrow">EMPLOYEE ROUTES</p><h2>Extensions and forwarding</h2><ul class="audit">${state.routeProfiles.map((profile) => `<li><strong>${escapeHtml(profile.name)}</strong> · ext ${escapeHtml(profile.extension)} · ${escapeHtml(profile.status.replaceAll("_", " "))}</li>`).join("") || "<li>No employee routes yet.</li>"}</ul><button class="secondary" data-view="control">Add or manage employees</button></section>` : "";
  const invite = state.permissions.managePeople && !state.permissions.manageRouting ? `<section class="card"><p class="eyebrow">INVITE A TEAMMATE</p><h2>Give them their own secure inbox</h2><form id="invite-team-form" class="form-grid"><label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Extension<input name="extension" inputmode="numeric" placeholder="101" required></label><label>Role<select name="role"><option value="agent">Agent — assigned inbox only</option><option value="manager">Manager — team inbox and assignments</option></select></label><button class="wide" type="submit">Create invite</button></form><div id="invite-result"></div></section>` : `<section class="card"><p class="eyebrow">YOUR ACCESS</p><h2>Private by default</h2><p class="muted">Your team lead manages membership. You only see the conversations assigned to your extension.</p></section>`;
  return `<div class="split"><section><div class="section-head"><h2>Team</h2><span class="muted">Extensions are internal IDs, never customer-facing numbers.</span></div><ul class="list">${members}</ul></section><div class="stack compact-stack">${routes}${invite}</div></div>`;
}

function routeProfileCard(profile) {
  const topics = profile.routingTopics.join(", ");
  return `<li class="card"><div class="row"><span><strong>${escapeHtml(profile.name)}</strong><br><span class="muted">Extension ${escapeHtml(profile.extension)} · ${escapeHtml(profile.status.replaceAll("_", " "))}</span></span><span class="pill ${profile.status === "active" ? "ready" : "warn"}">${profile.status === "active" ? "Account active" : "Needs account"}</span></div><form class="form-grid route-profile-form" data-route-profile="${escapeHtml(profile.id)}"><label>Name<input name="name" value="${escapeHtml(profile.name)}" required></label><label>Extension<input name="extension" value="${escapeHtml(profile.extension)}" required></label><label>Forward calls to<input name="callForwardNumber" value="${escapeHtml(profile.callForwardNumber || "")}" inputmode="tel" required></label><label>AI handoff topics<input name="routingTopics" value="${escapeHtml(topics)}" placeholder="billing, phone plans"></label><button class="wide secondary" type="submit">Save ${escapeHtml(profile.name)}’s route</button></form></li>`;
}

function controlView() {
  if (!state.permissions.manageRouting) return `<section class="card"><p class="eyebrow">CONTROL CENTER</p><h2>Owner-controlled</h2><p class="muted">The organization owner manages employee routes, organization-wide alerts, and phone-system connections.</p></section>`;
  const delivery = state.tenant.ownerDelivery;
  const connections = state.phoneConnections.map((connection) => `<li class="card row"><span><strong>${escapeHtml(connection.label)}</strong><br><span class="muted">${escapeHtml(connection.type === "mitel" ? "Mitel" : "Generic SIP")} · ext ${escapeHtml(connection.extension)}${connection.pbxHost ? ` · ${escapeHtml(connection.pbxHost)}` : ""}</span></span><span class="pill warn">${escapeHtml(connection.status.replaceAll("_", " "))}</span></li>`).join("");
  return `<div class="control-grid"><section class="card"><p class="eyebrow">OWNER DELIVERY</p><h2>Get every important text and voicemail</h2><p class="muted">Your owner inbox always sees the organization’s conversations. These rules also alert your personal number when a live Relay phone or PBX connection is active.</p><form id="owner-delivery-form" class="stack"><label><input name="textsToOwner" type="checkbox" ${delivery.textsToOwner ? "checked" : ""}> Alert me about every inbound text</label><label><input name="voicemailsToOwner" type="checkbox" ${delivery.voicemailsToOwner ? "checked" : ""}> Alert me about every voicemail</label><label>What goes to my personal alert number<select name="alertMode"><option value="summary" ${delivery.alertMode === "summary" ? "selected" : ""}>Private summary + secure inbox link</option><option value="full_content" ${delivery.alertMode === "full_content" ? "selected" : ""}>Full content (only after live connection)</option></select></label><p class="form-note">${delivery.alertPhoneConfigured ? "Your personal alert number is configured." : "Set your personal alert number in My profile before enabling phone alerts."}</p><button type="submit">Save owner delivery</button></form></section><section class="card"><p class="eyebrow">ADD EMPLOYEE</p><h2>One employee, one extension, one route</h2><p class="muted">This creates their route and a secure-account invite. Customers keep seeing your business number.</p><form id="employee-route-form" class="form-grid"><label>Name<input name="name" placeholder="Alex Smith" required></label><label>Email<input name="inviteEmail" type="email" placeholder="alex@company.com" required></label><label>Extension<input name="extension" inputmode="numeric" placeholder="101" required></label><label>Forward calls to<input name="callForwardNumber" inputmode="tel" placeholder="+15551234567" required></label><label>Role<select name="role"><option value="agent">Employee — assigned inbox</option><option value="manager">Manager — team inbox</option></select></label><label>AI handoff topics<input name="routingTopics" placeholder="billing, phone plans, support"></label><button class="wide" type="submit">Add employee and create invite</button></form><div id="employee-result"></div></section><section class="card wide-card"><p class="eyebrow">EMPLOYEE ROUTES</p><h2>Control extensions and forwarding</h2><p class="muted">Topics are saved for future AI/PBX routing. They do not automatically move calls or texts until a live connection is verified.</p><ul class="list">${state.routeProfiles.map(routeProfileCard).join("") || "<li class=\"empty\">Add your first employee route above.</li>"}</ul></section><section class="card"><p class="eyebrow">PHONE SYSTEM</p><h2>Plan a Mitel or SIP connection</h2><p class="muted">Add the destination here. Secure credentials and live PBX testing happen only during connection activation—never stored in this reference console.</p><form id="phone-connection-form" class="stack"><label>Phone system<select name="type"><option value="mitel">Mitel</option><option value="generic_sip">Generic SIP / VoIP</option></select></label><label>Connection name<input name="label" placeholder="Main office Mitel" required></label><label>PBX address (optional)<input name="pbxHost" placeholder="pbx.example.local"></label><label>PBX extension<input name="extension" inputmode="numeric" placeholder="101" required></label><button type="submit">Save connection plan</button></form></section><section><div class="section-head"><h2>Saved phone connections</h2><span class="muted">Not live until qualified.</span></div>${connections ? `<ul class="list">${connections}</ul>` : `<div class="card empty">No PBX or SIP connection plans yet. Relay phone pairing is in the Relay phone tab.</div>`}</section></div>`;
}

function phoneView() {
  if (!state.permissions.manageGateway) return `<section class="card"><p class="eyebrow">RELAY PHONE</p><h2>Owner-controlled</h2><p class="muted">The organization owner pairs and monitors the dedicated business phone. Team members never need the pairing credential.</p></section>`;
  const phones = state.gateways.map((gateway) => `<li class="card row"><span><strong>${escapeHtml(gateway.label)}</strong><br><span class="muted">${escapeHtml(gateway.phoneNumber)} · last seen ${gateway.lastHeartbeatAt ? new Date(gateway.lastHeartbeatAt).toLocaleString() : "never"}</span></span><span class="pill ${statusClass(gateway.state)}">${escapeHtml(gateway.state.replaceAll("_", " "))}</span></li>`).join("");
  const plan = state.tenant.phoneSetup;
  const services = [[plan.callsEnabled, "Calls forward to", plan.callForwardNumber || "not configured"], [plan.textsEnabled, "Texts", "secure inbox"], [plan.voicemailEnabled, "Voicemail", "saved and alerted"]].filter(([enabled]) => enabled).map(([, label, value]) => `<li>${escapeHtml(label)}: <strong>${escapeHtml(value)}</strong></li>`).join("");
  return `<div class="split"><section><div class="section-head"><h2>Relay phones</h2><span class="muted">The real SIM remains the customer-visible number.</span></div><div class="card"><p class="eyebrow">YOUR NUMBER PLAN</p><h3>${escapeHtml(state.tenant.mainNumber)}</h3><ul class="audit">${services}</ul><p class="muted">Saved and ready to connect to the Relay phone or PBX. Calls and voicemail do not activate until that connection is live.</p></div>${phones ? `<ul class="list">${phones}</ul>` : `<div class="card empty">Pair the dedicated business phone when the native gateway is ready.</div>`}<div class="section-head"><h2>Recent activity</h2></div><ul class="audit">${state.audit.slice(0, 8).map((item) => `<li>${escapeHtml(new Date(item.at).toLocaleString())} · ${escapeHtml(item.action.replaceAll(".", " "))}</li>`).join("") || "<li>No activity yet.</li>"}</ul></section><section class="card"><p class="eyebrow">PAIR A RELAY PHONE</p><h2>Create a one-time pairing credential</h2><p class="muted">Use this for the native app on the dedicated business phone. For Mitel or another VoIP phone, use Control center → Phone system.</p><form id="gateway-form" class="stack"><label>Phone name<input name="label" placeholder="Front desk phone" required></label><label>SIM number<input name="phoneNumber" value="${escapeHtml(state.tenant.mainNumber)}" inputmode="tel" required></label><button type="submit">Create pairing credential</button></form><div id="pairing-result"></div></section></div>`;
}

function profileView() {
  const viewer = state.viewer;
  const route = state.myRouteProfile ? `<section class="card"><p class="eyebrow">MY CALL ROUTE</p><h2>Extension ${escapeHtml(state.myRouteProfile.extension)}</h2><p class="muted">Set where calls assigned to your extension should ring. Your owner can still manage the business-wide route.</p><form id="my-route-form" class="stack"><label>Forward my calls to<input name="callForwardNumber" value="${escapeHtml(state.myRouteProfile.callForwardNumber || "")}" inputmode="tel" required></label><label>My AI handoff topics<input name="routingTopics" value="${escapeHtml(state.myRouteProfile.routingTopics.join(", "))}" placeholder="billing, phone plans"></label><button type="submit">Save my call route</button></form></section>` : `<section class="card"><p class="eyebrow">MY CALL ROUTE</p><h2>No employee route yet</h2><p class="muted">Your owner will assign your extension and call-forwarding route when they add you to the team.</p></section>`;
  return `<div class="split"><section class="card"><p class="eyebrow">MY PROFILE</p><h2>${escapeHtml(viewer.name)}</h2><p class="muted">${escapeHtml(viewer.email)} · ${escapeHtml(viewer.role)} · extension ${escapeHtml(viewer.extension)}</p><form id="profile-form" class="stack"><label>Your name<input name="name" value="${escapeHtml(viewer.name)}" required></label><label>Personal alert number<input name="personalPhone" inputmode="tel" placeholder="${viewer.alertPhoneConfigured ? "Configured — enter a new number to replace it" : "+15551234567"}"></label><label><input name="alertEnabled" type="checkbox" ${viewer.alertEnabled ? "checked" : ""}> Send important alerts to my personal number</label><button type="submit">Save my preferences</button></form></section>${route}</div>`;
}

function render() {
  if (!state) {
    show("auth");
    setAuthMode(authMode);
    return;
  }
  if (!state.tenant.phoneSetup?.completedAt) return show("phone-onboarding");
  show("dashboard");
  $("#organization-name").textContent = state.tenant.organizationName;
  $("#business-number").textContent = `Customer-visible number: ${state.tenant.mainNumber}`;
  $("#viewer-role").textContent = `${state.viewer.name.toUpperCase()} · ${state.viewer.role.toUpperCase()} · EXT ${state.viewer.extension}`;
  const controlTab = document.querySelector('[data-view="control"]');
  if (controlTab) controlTab.hidden = !state.permissions.manageRouting;
  if (activeView === "control" && !state.permissions.manageRouting) activeView = "inbox";
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView));
  $("#view").innerHTML = activeView === "control" ? controlView() : activeView === "team" ? teamView() : activeView === "phone" ? phoneView() : activeView === "profile" ? profileView() : inboxView();
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
  const authOption = event.target.closest("[data-auth-mode]");
  if (authOption) { setAuthMode(authOption.dataset.authMode); return; }
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
  if (event.target.id === "owner-delivery-form") { event.preventDefault(); const form = new FormData(event.target); try { await api("/api/owner-delivery", { method: "POST", body: JSON.stringify({ textsToOwner: form.get("textsToOwner") === "on", voicemailsToOwner: form.get("voicemailsToOwner") === "on", alertMode: form.get("alertMode") }) }); await refresh(); setNotice("Owner delivery rules are saved and waiting for a live phone connection."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "employee-route-form") { event.preventDefault(); try { const result = await api("/api/route-profiles", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); await refresh(); const output = $("#employee-result"); if (output && result.inviteCode) output.innerHTML = `<div class="key">Give this code only to ${escapeHtml(result.invitation.email)}. It expires ${escapeHtml(new Date(result.invitation.expiresAt).toLocaleDateString())}.<code>${escapeHtml(result.inviteCode)}</code></div>`; setNotice(`${result.profile.name} is assigned to extension ${result.profile.extension}.`); } catch (error) { setNotice(error.message); } return; }
  const routeProfileForm = event.target.closest("[data-route-profile]");
  if (routeProfileForm) { event.preventDefault(); try { await api(`/api/route-profiles/${routeProfileForm.dataset.routeProfile}`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(routeProfileForm))) }); await refresh(); setNotice("Employee route saved."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "phone-connection-form") { event.preventDefault(); try { await api("/api/phone-connections", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); await refresh(); setNotice("Phone-system connection plan saved. It is not live until securely connected and qualified."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "my-route-form") { event.preventDefault(); try { await api("/api/my-route-profile", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); await refresh(); setNotice("Your call-forwarding route is saved."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "invite-team-form") { event.preventDefault(); try { const result = await api("/api/invitations", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); await refresh(); const output = $("#invite-result"); if (output) output.innerHTML = `<div class="key">Give this code only to ${escapeHtml(result.invitation.email)}. It expires ${escapeHtml(new Date(result.invitation.expiresAt).toLocaleDateString())}.<code>${escapeHtml(result.inviteCode)}</code></div>`; setNotice("Invite created."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "gateway-form") { event.preventDefault(); try { const paired = await api("/api/gateways", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); await refresh(); const output = $("#pairing-result"); if (output) output.innerHTML = `<div class="key">Copy this into the native Relay app now. It cannot be recovered.<code>${escapeHtml(paired.gateway.id)}:${escapeHtml(paired.pairingToken)}</code></div>`; setNotice("Pairing credential created."); } catch (error) { setNotice(error.message); } return; }
  if (event.target.id === "profile-form") { event.preventDefault(); const form = new FormData(event.target); const body = { name: form.get("name"), alertEnabled: form.get("alertEnabled") === "on" }; if (form.get("personalPhone")) body.personalPhone = form.get("personalPhone"); try { await api("/api/profile", { method: "POST", body: JSON.stringify(body) }); await refresh(); setNotice("Your preferences are saved."); } catch (error) { setNotice(error.message); } }
});

(async () => {
  if (!sessionToken) return render();
  try { await refresh(); } catch { sessionStorage.removeItem("wgw-relay-session"); sessionToken = ""; state = null; render(); }
})();

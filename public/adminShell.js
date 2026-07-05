(function () {
  const navItems = [
    { href: "/admin.html", label: "Dashboard", section: "dashboard" },
    { href: "/admin-users.html", label: "Users", section: "users" },
    { href: "/admin-intelligence.html", label: "Intelligence", section: "intelligence" },
    { href: "/admin-playlists-v2.html", label: "Playlists", section: "playlists" },
    { href: "/admin-system.html", label: "System", section: "system" },
  ];

  function activeSection() {
    const explicit = document.body?.dataset?.adminSection;
    if (explicit) return explicit;
    const path = window.location.pathname;
    const item = navItems.find((nav) => nav.href === path);
    return item?.section || "dashboard";
  }

  function renderShell() {
    const main = document.querySelector("main");
    if (!main || document.querySelector(".admin-shell")) return;
    const section = activeSection();
    const shell = document.createElement("div");
    shell.className = "admin-shell";
    shell.innerHTML = `
      <aside class="admin-sidebar">
        <div class="admin-brand"><strong>Crate</strong><span>Admin V2</span></div>
        <nav class="admin-nav" aria-label="Crate admin">
          ${navItems.map((item) => `<a href="${item.href}" class="${item.section === section ? "is-active" : ""}">${item.label}</a>`).join("")}
        </nav>
      </aside>
    `;
    const content = document.createElement("div");
    content.className = "admin-main";
    main.replaceWith(shell);
    content.appendChild(main);
    shell.appendChild(content);
  }

  function initTabs() {
    document.querySelectorAll("[data-admin-tabs]").forEach((root) => {
      const tabs = [...root.querySelectorAll("[data-tab-target]")];
      const panels = [...root.querySelectorAll("[data-tab-panel]")];
      function activate(name) {
        tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tabTarget === name));
        panels.forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== name; });
      }
      tabs.forEach((tab) => tab.addEventListener("click", () => activate(tab.dataset.tabTarget)));
      activate(tabs.find((tab) => tab.classList.contains("is-active"))?.dataset.tabTarget || tabs[0]?.dataset.tabTarget);
    });
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || `Request failed: ${response.status}`);
    return body;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  window.CrateAdmin = { requestJson, formatNumber, escapeHtml };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { renderShell(); initTabs(); });
  } else {
    renderShell();
    initTabs();
  }
})();

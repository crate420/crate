(function () {
  const links = [
    { href: "/admin.html", label: "Dashboard" },
    { href: "/admin-users.html", label: "Users" },
    { href: "/admin-intelligence.html", label: "Intelligence" },
    { href: "/admin-playlists-v2.html", label: "Playlists" },
    { href: "/admin-system.html", label: "System" },
  ];

  function injectStyles() {
    if (document.getElementById("crateAdminNavStyles")) return;
    const style = document.createElement("style");
    style.id = "crateAdminNavStyles";
    style.textContent = `
      .crate-admin-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 12px 0 18px;
        width: 100%;
      }
      .crate-admin-nav-link {
        border: 1px solid #d7dde5;
        border-radius: 999px;
        color: inherit;
        display: inline-flex;
        font: inherit;
        font-size: 13px;
        font-weight: 800;
        min-height: 32px;
        padding: 6px 10px;
        text-decoration: none;
      }
      .crate-admin-nav-link:hover,
      .crate-admin-nav-link.is-active {
        border-color: #1769aa;
        color: #1769aa;
      }
    `;
    document.head.appendChild(style);
  }

  function renderNav(target) {
    const currentPath = window.location.pathname;
    target.className = "crate-admin-nav";
    target.setAttribute("aria-label", "Crate admin navigation");
    target.innerHTML = links.map((link) => `<a class="crate-admin-nav-link${currentPath === link.href ? " is-active" : ""}" href="${link.href}">${link.label}</a>`).join("");
  }

  function init() {
    injectStyles();
    const target = document.querySelector("[data-admin-nav]") || document.querySelector("header nav") || document.querySelector("main > nav") || document.querySelector("nav");
    if (target) {
      renderNav(target);
      return;
    }
    const container = document.createElement("nav");
    renderNav(container);
    const main = document.querySelector("main") || document.body;
    main.insertBefore(container, main.firstElementChild ? main.firstElementChild.nextSibling : null);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

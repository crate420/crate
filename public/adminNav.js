(function () {
  const groups = [
    {
      label: 'Dashboard',
      links: [
        { href: '/admin.html', label: 'Admin Home' },
      ],
    },
    {
      label: 'Users',
      links: [
        { href: '/admin-user-diagnostics.html', label: 'User Diagnostics' },
        { href: '/admin-user-unmatched-export.html', label: 'User Unmatched Export' },
      ],
    },
    {
      label: 'Recovery',
      links: [
        { href: '/admin-unmatched-diagnostics.html', label: 'Unmatched Forensics' },
        { href: '/admin-artist-gap-analysis.html', label: 'Artist Gaps' },
        { href: '/admin-learning.html', label: 'Learning Signals' },
        { href: '/admin-unmatched.html', label: 'Manual Track Assignment', tone: 'advanced' },
      ],
    },
    {
      label: 'Intelligence',
      links: [
        { href: '/admin-intelligence-coverage.html', label: 'Intelligence Coverage' },
        { href: '/admin-artist-intelligence.html', label: 'Artist Intelligence' },
        { href: '/admin-artist-enrichment-queue.html', label: 'Artist Enrichment Queue' },
        { href: '/admin-track-intelligence.html', label: 'Track Intelligence' },
        { href: '/admin-track-learning.html', label: 'Track Learning', tone: 'advanced' },
        { href: '/admin-era-diagnostics.html', label: 'Era Evidence' },
      ],
    },
    {
      label: 'Approvals',
      links: [
        { href: '/admin-genre-recommendations.html', label: 'Genre Recommendations' },
        { href: '/admin-genre-recommendation-rescan.html', label: 'Recommendation Rescan' },
        { href: '/admin-recommendation-impact.html', label: 'Recommendation Impact' },
        { href: '/admin-review.html', label: 'Artist Review Queue', tone: 'advanced' },
        { href: '/admin-artist-recommendations.html', label: 'Artist Intelligence Recommendations', tone: 'advanced' },
      ],
    },
    {
      label: 'Playlists / Specialty',
      links: [
        { href: '/admin-specialty-discovery.html', label: 'Specialty Discovery' },
        { href: '/admin-specialty-validation.html', label: 'Specialty Validation' },
        { href: '/admin-playlist-dna-validation.html', label: 'Playlist DNA Validation' },
        { href: '/admin-dna-evidence-quality.html', label: 'DNA Evidence Quality' },
        { href: '/admin-playlist-seeds.html', label: 'Playlist Seeds' },
      ],
    },
    {
      label: 'System / Maintenance',
      links: [
        { href: '/admin-playlists.html', label: 'Playlist Admin', tone: 'advanced' },
      ],
    },
  ];

  function injectStyles() {
    if (document.getElementById('crateAdminNavStyles')) return;
    const style = document.createElement('style');
    style.id = 'crateAdminNavStyles';
    style.textContent = `
      .crate-admin-nav {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 8px;
        width: 100%;
        margin: 12px 0 18px;
        align-items: stretch;
      }
      .crate-admin-nav-group {
        border: 1px solid rgba(52, 211, 238, 0.24);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.035);
        padding: 8px;
        min-width: 0;
      }
      .crate-admin-nav-title {
        margin: 0 0 7px;
        color: #21d4d4;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .crate-admin-nav-links {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .crate-admin-nav-link {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        border: 1px solid rgba(184, 192, 212, 0.25);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.045);
        color: inherit;
        font: inherit;
        font-size: 12px;
        font-weight: 750;
        line-height: 1.2;
        padding: 5px 8px;
        text-decoration: none;
        white-space: nowrap;
      }
      .crate-admin-nav-link.is-advanced {
        border-style: dashed;
        color: rgba(184, 192, 212, 0.82);
        font-weight: 650;
      }
      .crate-admin-nav-link:hover,
      .crate-admin-nav-link.is-active {
        border-color: #21d4d4;
        color: #21d4d4;
      }
      @media (max-width: 760px) {
        .crate-admin-nav { grid-template-columns: 1fr; }
        .crate-admin-nav-link { white-space: normal; }
      }
    `;
    document.head.appendChild(style);
  }

  function renderNav(target) {
    const currentPath = window.location.pathname;
    target.className = 'crate-admin-nav';
    target.setAttribute('aria-label', 'Crate admin navigation');
    target.innerHTML = groups.map((group) => {
      const links = group.links.map((link) => {
        const activeClass = currentPath === link.href ? ' is-active' : '';
        const toneClass = link.tone === 'advanced' ? ' is-advanced' : '';
        return `<a class="crate-admin-nav-link${activeClass}${toneClass}" href="${link.href}">${link.label}</a>`;
      }).join('');
      return `<section class="crate-admin-nav-group"><h2 class="crate-admin-nav-title">${group.label}</h2><div class="crate-admin-nav-links">${links}</div></section>`;
    }).join('');
  }

  function init() {
    injectStyles();
    const target = document.querySelector('[data-admin-nav]') || document.querySelector('header nav') || document.querySelector('main > nav') || document.querySelector('nav');
    if (target) {
      renderNav(target);
      return;
    }
    const container = document.createElement('nav');
    renderNav(container);
    const main = document.querySelector('main') || document.body;
    main.insertBefore(container, main.firstElementChild ? main.firstElementChild.nextSibling : null);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

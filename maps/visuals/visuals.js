/* global pdfjsLib */
(() => {
  const body = document.body;
  const repoOwner = body.dataset.repoOwner;
  const repoName = body.dataset.repoName;
  const branch = body.dataset.branch || "main";
  const mapsPath = body.dataset.mapsPath || "maps";

  const galleryGrid = document.getElementById("galleryGrid");
  const galleryCount = document.getElementById("galleryCount");
  const gallerySource = document.getElementById("gallerySource");
  const galleryEmpty = document.getElementById("galleryEmpty");
  const searchInput = document.getElementById("searchInput");
  const sortSelect = document.getElementById("sortSelect");
  const filterButtons = Array.from(document.querySelectorAll(".filter-group button"));

  const lightbox = document.getElementById("lightbox");
  const lightboxBody = document.getElementById("lightboxBody");
  const lightboxTitle = document.getElementById("lightboxTitle");
  const lightboxClose = document.getElementById("lightboxClose");

  const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".pdf"];
  const state = {
    items: [],
    query: "",
    filter: "all",
    sort: "name-asc",
    source: ""
  };

  document.getElementById("year").textContent = new Date().getFullYear();

  const normalizeName = (name) => {
    const noExt = name.replace(/\.[^/.]+$/, "");
    return noExt
      .replace(/[_-]+/g, " ")
      .replace(/\s*\(\d+\)\s*$/g, "")
      .trim();
  };

  const getExtension = (name) => {
    const lower = name.toLowerCase();
    const match = SUPPORTED_EXTENSIONS.find(ext => lower.endsWith(ext));
    return match || "";
  };

  const fileType = (ext) => (ext === ".pdf" ? "pdf" : "image");

  const formatBytes = (bytes) => {
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  };

  const relativePathFromMaps = (path) => {
    if (path.startsWith(`${mapsPath}/`)) {
      return `../${path.slice(mapsPath.length + 1)}`;
    }
    return `../${path.replace(/^\//, "")}`;
  };

  const fetchFromGitHub = async () => {
    if (!repoOwner || !repoName) {
      throw new Error("Missing repo config");
    }
    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${mapsPath}?ref=${branch}`;
    const response = await fetch(apiUrl, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) {
      throw new Error("GitHub API failed");
    }
    const data = await response.json();
    const files = data.filter(item => item.type === "file" && getExtension(item.name));
    return files.map(item => ({
      name: item.name,
      path: item.path,
      size: item.size
    }));
  };

  const fetchFromManifest = async () => {
    const response = await fetch("../manifest.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("manifest missing");
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("invalid manifest");
    }
    return data
      .map(entry => (typeof entry === "string" ? { name: entry, path: `${mapsPath}/${entry}` } : entry))
      .filter(item => item && item.name && getExtension(item.name));
  };

  const loadFiles = async () => {
    galleryCount.textContent = "Loading...";
    const preferManifest = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
      || window.location.protocol === "file:";

    const firstAttempt = preferManifest ? fetchFromManifest : fetchFromGitHub;
    const fallbackAttempt = preferManifest ? fetchFromGitHub : fetchFromManifest;

    try {
      state.items = await firstAttempt();
      state.source = preferManifest ? "manifest.json" : "GitHub";
    } catch (error) {
      try {
        state.items = await fallbackAttempt();
        state.source = preferManifest ? "GitHub" : "manifest.json";
      } catch (manifestError) {
        state.items = [];
        state.source = "none";
      }
    }

    if (state.source === "GitHub") {
      gallerySource.textContent = "Source: GitHub";
    } else if (state.source === "manifest.json") {
      gallerySource.textContent = "Source: manifest.json";
    } else {
      gallerySource.textContent = "Source: unavailable";
    }

    render();
  };

  const sortItems = (items) => {
    const sorted = [...items];
    switch (state.sort) {
      case "name-desc":
        sorted.sort((a, b) => normalizeName(b.name).localeCompare(normalizeName(a.name)));
        break;
      case "size-desc":
        sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
        break;
      case "size-asc":
        sorted.sort((a, b) => (a.size || 0) - (b.size || 0));
        break;
      case "name-asc":
      default:
        sorted.sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name)));
        break;
    }
    return sorted;
  };

  const filterItems = (items) => {
    const query = state.query.toLowerCase();
    return items.filter(item => {
      const ext = getExtension(item.name);
      if (!ext) return false;
      const typeMatch = state.filter === "all" || fileType(ext) === state.filter;
      const queryMatch = normalizeName(item.name).toLowerCase().includes(query);
      return typeMatch && queryMatch;
    });
  };

  const renderPdfPreview = (canvas, src) => {
    if (!window.pdfjsLib) return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    pdfjsLib.getDocument(src).promise.then(pdf => pdf.getPage(1)).then(page => {
      const viewport = page.getViewport({ scale: 1 });
      const maxWidth = 420;
      const scale = maxWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      const ctx = canvas.getContext("2d");
      return page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
    }).catch(() => {
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    });
  };

  const openLightbox = (item) => {
    lightboxBody.innerHTML = "";
    lightboxTitle.textContent = normalizeName(item.name);

    const ext = getExtension(item.name);
    const src = relativePathFromMaps(item.path || item.name);

    if (ext === ".pdf") {
      const frame = document.createElement("iframe");
      frame.src = `${src}#view=fitH`;
      frame.title = item.name;
      frame.loading = "lazy";
      lightboxBody.appendChild(frame);
    } else {
      const img = document.createElement("img");
      img.src = src;
      img.alt = normalizeName(item.name);
      img.loading = "lazy";
      lightboxBody.appendChild(img);
    }

    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
  };

  const closeLightbox = () => {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    lightboxBody.innerHTML = "";
  };

  const render = () => {
    const filtered = filterItems(state.items);
    const sorted = sortItems(filtered);

    galleryGrid.innerHTML = "";
    galleryCount.textContent = `${sorted.length} item${sorted.length === 1 ? "" : "s"}`;
    galleryEmpty.style.display = sorted.length ? "none" : "block";

    sorted.forEach(item => {
      const ext = getExtension(item.name);
      if (!ext) return;
      const typeLabel = ext.replace(".", "").toUpperCase();
      const src = relativePathFromMaps(item.path || item.name);

      const card = document.createElement("article");
      card.className = "gallery-card";

      const previewButton = document.createElement("button");
      previewButton.type = "button";
      previewButton.className = "gallery-preview";
      previewButton.addEventListener("click", () => openLightbox(item));

      if (ext === ".pdf") {
        const canvas = document.createElement("canvas");
        canvas.height = 260;
        canvas.width = 420;
        previewButton.appendChild(canvas);
        renderPdfPreview(canvas, src);
      } else {
        const img = document.createElement("img");
        img.src = src;
        img.alt = normalizeName(item.name);
        img.loading = "lazy";
        previewButton.appendChild(img);
      }

      const caption = document.createElement("div");
      caption.className = "gallery-caption";

      const title = document.createElement("p");
      title.className = "gallery-title";
      title.textContent = normalizeName(item.name);

      const tag = document.createElement("span");
      tag.className = "gallery-tag";
      tag.textContent = typeLabel;

      caption.appendChild(title);
      caption.appendChild(tag);

      const actions = document.createElement("div");
      actions.className = "gallery-actions";
      const openLink = document.createElement("a");
      openLink.href = src;
      openLink.target = "_blank";
      openLink.rel = "noreferrer";
      openLink.textContent = "Open file";

      const sizeLabel = document.createElement("span");
      sizeLabel.className = "gallery-tag";
      sizeLabel.textContent = formatBytes(item.size);

      actions.appendChild(openLink);
      if (item.size) {
        actions.appendChild(sizeLabel);
      }

      card.appendChild(previewButton);
      card.appendChild(caption);
      card.appendChild(actions);
      galleryGrid.appendChild(card);
    });
  };

  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  filterButtons.forEach(button => {
    button.addEventListener("click", () => {
      filterButtons.forEach(btn => btn.classList.remove("is-active"));
      button.classList.add("is-active");
      state.filter = button.dataset.filter || "all";
      render();
    });
  });

  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      closeLightbox();
    }
  });

  lightboxClose.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && lightbox.classList.contains("is-open")) {
      closeLightbox();
    }
  });

  loadFiles();
})();

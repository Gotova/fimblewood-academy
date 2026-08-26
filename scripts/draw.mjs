/**
 * Fimblewood Academy — Magic Circle Draw Pad
 * Ported from the standalone "FoundryDraw" module (Gotova/FoundryDraw v1.6.37) so it
 * ships as part of Fimblewood Academy instead of a separate install. This is the full
 * SVG-based drawing engine (brush/eraser/line/circle/rect/text/select, symmetry,
 * undo/redo, ink counter + spell-level badge, per-user gallery with folders, and a
 * GM live-draw broadcast) — drawing logic is unchanged; only naming (module id,
 * DOM/CSS classes, i18n keys) and the scene-control registration were reworked to
 * fit here, and the client-scope "migrate an old local gallery" shim was dropped
 * (it could never find anything under this module's fresh id).
 */

const MODULE_ID = "fimblewood-academy";
const CONTROL_GROUP = "fimblewood-magic";

// ─── World coordinate space ───────────────────────────────────────────────────
// All drawing coordinates are in a 2000×2000 world.  The display is a
// zoomable / pannable viewport (SVG viewBox) into that world.
const WORLD_SIZE  = 2000;
const MAX_HISTORY = 20;
const ZOOM_MIN    = 0.1;
const ZOOM_MAX    = 8.0;
const ZOOM_FACTOR = 1.15;
const SVG_NS      = "http://www.w3.org/2000/svg";
const PARCHMENT   = "#e8d5a3";   // background fill colour (also used by eraser)

/* ──────────────────────────────────────────────
   Gallery storage (server-side, per user)

   Drawings are stored as flags on the user document, which lives in the
   world database on the server — so the gallery follows the player to any
   machine. Users can always write their own flags (no GM permission needed).
   ────────────────────────────────────────────── */

function getGalleryData() {
  return foundry.utils.deepClone(game.user.getFlag(MODULE_ID, "gallery") ?? []);
}

async function setGalleryData(gallery) {
  await game.user.setFlag(MODULE_ID, "gallery", gallery);
}

function getFolderData() {
  return foundry.utils.deepClone(game.user.getFlag(MODULE_ID, "galleryFolders") ?? []);
}

async function setFolderData(folders) {
  await game.user.setFlag(MODULE_ID, "galleryFolders", folders);
}

/* ──────────────────────────────────────────────
   Application
   ────────────────────────────────────────────── */

class DrawPadApp extends Application {
  constructor(options = {}) {
    super(options);

    this._history   = [];
    this._redoStack = [];
    this._drawing   = false;
    this._panning   = false;
    this._lastX     = 0;   // world coords of last stabilised brush position
    this._lastY     = 0;
    this._startX    = 0;   // world coords at pointer-down (for shapes)
    this._startY    = 0;
    this._panLastX  = 0;   // client coords for pan delta calculation
    this._panLastY  = 0;

    this._tool       = "brush";
    this._color      = "#030821";
    this._brushSize  = 4;
    this._smoothness = 10;  // 0 = off, 1-10 = increasing EMA stabilisation
    this._smoothX    = 0;   // stabilised draw position (world coords)
    this._smoothY    = 0;
    this._opacity    = 1.0;
    this._symmetry   = 1;
    this._keyHandler = null;

    // Viewport state (same model as the old canvas approach)
    this._zoom  = 1.0;
    this._viewX = 0;   // world-x at the top-left of the viewport
    this._viewY = 0;   // world-y at the top-left of the viewport

    // Insert-circle mode: true while waiting for the user to click a radius
    this._insertCircleMode = false;

    // Live-stroke state: one <path> per symmetry axis while the pointer is down
    this._activePaths  = [];
    this._pathDataArr  = [];
    // Parallel array of white "unmask" paths added to the erase mask alongside
    // each brush stroke so that drawing always shows even over erased areas.
    // null entries correspond to eraser strokes (which don't need an unmask).
    this._unmaskPaths  = [];

    // Live-draw broadcast state (GM only)
    this._liveDrawing   = false;
    this._lastLiveEmit  = 0;

    // Text tool — floating input overlay
    this._textInputWrap = null;

    // Select tool state
    this._selectedEls        = [];    // array of currently selected SVG elements
    this._selBaseTransforms  = [];    // matching transforms at selection / commit time
    this._selHandle          = null;  // "move" | "rotate" | "marquee" | null
    this._selDragStartX      = 0;     // world coords when the drag began
    this._selDragStartY      = 0;
    this._selRotCenter       = null;  // { x, y } world: rotation pivot
    this._selRotHandleWorld  = null;  // { x, y } world: cached handle position
    this._selCloseHandleWorld= null;  // { x, y } world: cached close-button position
    this._marqueeRect        = null;  // live <rect> element drawn during marquee drag
    this._marqueeAdditive    = false; // true when marquee was started with Shift held
    this._selRefWorldPos     = null;  // world-space ref point (bbox top-left) at move-drag start
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id:          "fimblewood-draw-app",
      title:       game.i18n.localize("FIMBLEWOOD.Draw.WindowTitle"),
      template:    null,
      classes:     ["fimblewood-draw-app"],
      width:       820,
      height:      700,
      resizable:   true,
      minimizable: true,
    });
  }

  async _renderInner() {
    const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Draw.${k}`);

    const html = `
<div class="fimblewood-draw-toolbar">

  <button class="fw-draw-tool-btn" data-tool="select" data-tooltip="${i18n("Tools.Select")}">
    <i class="fas fa-mouse-pointer"></i>
  </button>
  <button class="fw-draw-tool-btn active" data-tool="brush"  data-tooltip="${i18n("Tools.Brush")}">
    <i class="fas fa-paint-brush"></i>
  </button>
  <button class="fw-draw-tool-btn" id="fw-draw-insert-circle" data-tooltip="${i18n("Actions.InsertCircle")}">
    <i class="fas fa-circle-plus"></i>
  </button>
  <button class="fw-draw-tool-btn" data-tool="eraser"        data-tooltip="${i18n("Tools.Eraser")}">
    <i class="fas fa-eraser"></i>
  </button>
  <button class="fw-draw-tool-btn" data-tool="line"          data-tooltip="${i18n("Tools.Line")}">
    <i class="fas fa-minus"></i>
  </button>
  <button class="fw-draw-tool-btn" data-tool="circle"        data-tooltip="${i18n("Tools.Circle")}">
    <i class="fas fa-circle-notch"></i>
  </button>
  <button class="fw-draw-tool-btn" data-tool="rect"          data-tooltip="${i18n("Tools.Rectangle")}">
    <i class="fas fa-square"></i>
  </button>
  <button class="fw-draw-tool-btn" data-tool="text"          data-tooltip="${i18n("Tools.Text")}">
    <i class="fas fa-font"></i>
  </button>

  <div class="separator"></div>

  <div class="fw-draw-color-btn" title="${i18n("Settings.Color")}">
    <input type="color" id="fw-draw-color-picker" value="#030821">
  </div>

  <div class="separator"></div>

  <div class="fw-draw-slider-group">
    <label>${i18n("Settings.BrushSize")}</label>
    <input type="range" id="fw-draw-brush-size" min="1" max="20" value="${this._brushSize}">
    <span class="fw-draw-val" id="fw-draw-brush-size-val">${this._brushSize}</span>
  </div>

  <div class="fw-draw-slider-group">
    <label>${i18n("Settings.Smoothness")}</label>
    <input type="range" id="fw-draw-smooth" min="0" max="10" value="10">
    <span class="fw-draw-val" id="fw-draw-smooth-val">10</span>
  </div>

  <div class="separator"></div>

  <div class="fw-draw-slider-group">
    <label>${i18n("Settings.Symmetry")}</label>
    <select class="fw-draw-select" id="fw-draw-symmetry">
      <option value="1"  selected>${i18n("Settings.SymmetryNone")}</option>
      <option value="2">${i18n("Settings.Symmetry2")}</option>
      <option value="4">${i18n("Settings.Symmetry4")}</option>
      <option value="6">${i18n("Settings.Symmetry6")}</option>
      <option value="8">${i18n("Settings.Symmetry8")}</option>
      <option value="12">${i18n("Settings.Symmetry12")}</option>
    </select>
  </div>

  <div class="separator"></div>

  <button class="fw-draw-tool-btn" id="fw-draw-undo"          data-tooltip="${i18n("Actions.Undo")}">
    <i class="fas fa-undo"></i>
  </button>
  <button class="fw-draw-tool-btn" id="fw-draw-redo"          data-tooltip="${i18n("Actions.Redo")}">
    <i class="fas fa-redo"></i>
  </button>
  <button class="fw-draw-tool-btn" id="fw-draw-center-view"   data-tooltip="${i18n("Actions.CenterView")}">
    <i class="fas fa-compress-arrows-alt"></i>
  </button>
  <button class="fw-draw-tool-btn" id="fw-draw-clear"         data-tooltip="${i18n("Actions.Clear")}">
    <i class="fas fa-trash"></i>
  </button>
  <button class="fw-draw-tool-btn" id="fw-draw-clipboard"     data-tooltip="${i18n("Actions.CopyClipboard")}">
    <i class="fas fa-clipboard"></i>
  </button>
  <button class="fw-draw-tool-btn" id="fw-draw-send-chat"     data-tooltip="${i18n("Actions.SendToChat")}">
    <i class="fas fa-paper-plane"></i>
  </button>
  <button class="fw-draw-tool-btn" id="fw-draw-save-gallery"  data-tooltip="${i18n("Actions.SaveGallery")}">
    <i class="fas fa-floppy-disk"></i>
  </button>
  <button class="fw-draw-tool-btn" id="fw-draw-save"          data-tooltip="${i18n("Actions.Save")}">
    <i class="fas fa-download"></i>
  </button>

  ${game.user.isGM ? `
  <div class="separator"></div>
  <button class="fw-draw-tool-btn" id="fw-draw-show-players" data-tooltip="${i18n("Actions.ShowPlayers")}">
    <i class="fas fa-eye"></i>
  </button>
  <button class="fw-draw-tool-btn" id="fw-draw-live-draw" data-tooltip="${i18n("Actions.LiveDraw")}">
    <i class="fas fa-broadcast-tower"></i>
  </button>` : ""}

</div>

<div class="fimblewood-draw-canvas-wrap" id="fw-draw-canvas-wrap">
  <svg id="fimblewood-draw-svg" xmlns="${SVG_NS}"></svg>
  <div id="fw-draw-center-marker" title="${i18n("Settings.SymmetryCenter")}"><span></span></div>
  <div id="fw-draw-spell-level" title="${i18n("Status.SpellLevelTooltip")}"></div>
</div>

<div class="fimblewood-draw-status">
  <span class="fw-draw-coords" id="fw-draw-coords">x: 0  y: 0</span>
  <span id="fw-draw-zoom-info">100%</span>
  <span id="fw-draw-history-info">Undo: 0</span>
  <span id="fw-draw-ink-info" title="${i18n("Status.InkTooltip")}">&#x1F58B; 0</span>
</div>`;

    return $(html);
  }

  /* ── Lifecycle ── */

  activateListeners(html) {
    super.activateListeners(html);

    this._wrap = document.getElementById("fw-draw-canvas-wrap");
    this._svg  = document.getElementById("fimblewood-draw-svg");

    if (!this._wrap || !this._svg) {
      console.error(`${MODULE_ID} | SVG element not found in DOM`);
      return;
    }

    // Build SVG structure (defs, background layers, content/preview groups)
    this._buildSvgStructure();

    this._initWhenReady(0);
    this._bindControls(html);
    this._bindSvgEvents();

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(this._wrap);

    this._keyHandler = (e) => {
      if (!this.rendered) return;
      const focused = document.activeElement;
      if (focused && (
        focused.tagName === "INPUT" ||
        focused.tagName === "TEXTAREA" ||
        focused.isContentEditable
      )) return;
      if (e.key === "Escape") {
        if (this._insertCircleMode)    this._exitCircleMode();
        if (this._selectedEls.length)  this._doDeselect();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && this._selectedEls.length) {
        e.preventDefault();
        e.stopPropagation();
        this._deleteSelected();
        return;
      }
      const isZ = e.key === "z" || e.key === "Z";
      if (e.ctrlKey && isZ && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); this._undo(); return; }
      if (e.ctrlKey && isZ &&  e.shiftKey) { e.preventDefault(); e.stopPropagation(); this._redo(); return; }
      if (e.ctrlKey && e.key === "y")       { e.preventDefault(); e.stopPropagation(); this._redo(); return; }
    };
    document.addEventListener("keydown", this._keyHandler, true);
  }

  setPosition(pos = {}) {
    const result = super.setPosition(pos);
    requestAnimationFrame(() => this._onResize());
    return result;
  }

  async close(options = {}) {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._keyHandler) document.removeEventListener("keydown", this._keyHandler, true);
    return super.close(options);
  }

  /* ──────────────────────────────────────────────
     SVG helpers
     ────────────────────────────────────────────── */

  /** Create an SVG-namespaced element with a map of attributes. */
  _svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  /**
   * Populate the initially-empty <svg> element with the permanent structure:
   *   <defs>  vignette gradient + grid pattern
   *   <rect>  parchment background
   *   <rect>  vignette overlay
   *   <rect>  grid overlay
   *   <g id="fw-draw-content">   drawing elements (subject to undo/redo)
   *   <g id="fw-draw-preview">   live shape preview while dragging (never in history)
   *
   * Called once in activateListeners(); also safe to call again after re-render.
   */
  _buildSvgStructure() {
    // Clear any previous content (safe for re-render)
    while (this._svg.firstChild) this._svg.removeChild(this._svg.firstChild);

    /* ── defs ── */
    const defs = this._svgEl("defs");

    // Radial vignette gradient (matches the old canvas vignette: transparent centre,
    // slightly darkened edges).  r = 80% of world size ≈ inner-radius / outer-radius ratio.
    const grad = this._svgEl("radialGradient", {
      id:             "fw-draw-vignette",
      gradientUnits:  "userSpaceOnUse",
      cx: WORLD_SIZE / 2,  cy: WORLD_SIZE / 2,
      r:  WORLD_SIZE * 0.8,
      fx: WORLD_SIZE / 2,  fy: WORLD_SIZE / 2,
    });
    grad.appendChild(this._svgEl("stop", { offset: "0%",   "stop-color": "rgba(0,0,0,0)" }));
    grad.appendChild(this._svgEl("stop", { offset: "31%",  "stop-color": "rgba(0,0,0,0)" }));
    grad.appendChild(this._svgEl("stop", { offset: "100%", "stop-color": "rgba(60,30,0,0.2)" }));

    // 20×20 world-unit reference grid.
    // vector-effect="non-scaling-stroke" keeps lines hairline-thin at every zoom level.
    const pat = this._svgEl("pattern", {
      id:            "fw-draw-grid-pat",
      x: 0,  y: 0,
      width:  20,  height: 20,
      patternUnits: "userSpaceOnUse",
    });
    pat.appendChild(this._svgEl("path", {
      d:                 "M 20 0 L 0 0 0 20",
      fill:              "none",
      stroke:            "rgba(160,110,30,0.8)",
      "stroke-width":    "0.5",
      "vector-effect":   "non-scaling-stroke",
    }));

    // Paper grain filter: fractal noise blended onto the parchment base colour.
    // baseFrequency is tuned for a 2000-unit world (~8–20 px per cycle at 100% zoom).
    // slope/intercept on each channel shift noise into the range 0.85–1.0 so the
    // result is a subtle warm-toned darkening, never bleaching.
    const grainFilter = this._svgEl("filter", {
      id: "fw-draw-paper-grain",
      x: "0%", y: "0%", width: "100%", height: "100%",
      "color-interpolation-filters": "sRGB",
    });
    const turb = this._svgEl("feTurbulence", {
      type:          "fractalNoise",
      baseFrequency: "0.035 0.015",
      numOctaves:    "4",
      stitchTiles:   "stitch",
      result:        "noise",
    });
    const xfer = this._svgEl("feComponentTransfer", { in: "noise", result: "grain" });
    xfer.appendChild(this._svgEl("feFuncR", { type: "linear", slope: "0.15", intercept: "0.85" }));
    xfer.appendChild(this._svgEl("feFuncG", { type: "linear", slope: "0.12", intercept: "0.88" }));
    xfer.appendChild(this._svgEl("feFuncB", { type: "linear", slope: "0.06", intercept: "0.94" }));
    grainFilter.appendChild(turb);
    grainFilter.appendChild(xfer);
    grainFilter.appendChild(this._svgEl("feBlend", {
      in: "SourceGraphic", in2: "grain", mode: "multiply",
    }));
    defs.appendChild(grainFilter);

    // Erase mask: a white background rect (= show everything) with black eraser
    // strokes added on top (black = transparent = erased).  The content group
    // references this mask so any black stroke in the mask punches a real hole
    // through the drawing without affecting the parchment background behind it.
    const eraseMask = this._svgEl("mask", { id: "fw-draw-erase-mask" });
    eraseMask.appendChild(this._svgEl("rect", {
      x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE, fill: "white",
    }));
    const erasePaths = this._svgEl("g", { id: "fw-draw-erase-paths" });
    eraseMask.appendChild(erasePaths);

    defs.appendChild(grad);
    defs.appendChild(pat);
    defs.appendChild(eraseMask);
    this._svg.appendChild(defs);

    // Keep a live reference to the eraser-paths group so strokes can be appended
    // to it without an expensive querySelector on every pointer-move.
    this._erasePaths = erasePaths;

    /* ── permanent background layers (never cleared) ── */
    this._svg.appendChild(this._svgEl("rect", {
      x: 0,  y: 0,  width: WORLD_SIZE,  height: WORLD_SIZE,
      fill:   PARCHMENT,
      filter: "url(#fw-draw-paper-grain)",
    }));
    this._svg.appendChild(this._svgEl("rect", {
      x: 0,  y: 0,  width: WORLD_SIZE,  height: WORLD_SIZE,
      fill: "url(#fw-draw-vignette)",
      "pointer-events": "none",
    }));
    this._svg.appendChild(this._svgEl("rect", {
      id:               "fw-draw-grid-overlay",
      x: 0,  y: 0,  width: WORLD_SIZE,  height: WORLD_SIZE,
      fill:             "url(#fw-draw-grid-pat)",
      "pointer-events": "none",
    }));

    /* ── drawing content (undo/redo operates on this group) ── */
    this._contentGroup = this._svgEl("g", {
      id:               "fw-draw-content",
      "pointer-events": "none",
      mask:             "url(#fw-draw-erase-mask)",
    });
    this._svg.appendChild(this._contentGroup);

    /* ── shape preview during drag (temporary, never saved to history) ── */
    this._previewGroup = this._svgEl("g", {
      id:               "fw-draw-preview",
      "pointer-events": "none",
    });
    this._svg.appendChild(this._previewGroup);

    /* ── eraser cursor overlay (always on top, updated on every pointer-move) ── */
    // Two concentric circles: outer dark ring (visible on parchment) +
    // inner white ring (visible on dark drawing strokes).
    // vector-effect="non-scaling-stroke" keeps pixel-width constant at all zoom levels.
    this._cursorGroup = this._svgEl("g", {
      id:               "fw-draw-cursor",
      "pointer-events": "none",
      visibility:       "hidden",
    });
    this._cursorOuter = this._svgEl("circle", {
      fill:             "none",
      stroke:           "rgba(0,0,0,0.45)",
      "stroke-width":   "2.5",
      "vector-effect":  "non-scaling-stroke",
    });
    this._cursorInner = this._svgEl("circle", {
      fill:             "none",
      stroke:           "rgba(255,255,255,0.85)",
      "stroke-width":   "1",
      "vector-effect":  "non-scaling-stroke",
    });
    this._cursorGroup.appendChild(this._cursorOuter);
    this._cursorGroup.appendChild(this._cursorInner);
    this._svg.appendChild(this._cursorGroup);
  }

  /* ──────────────────────────────────────────────
     Initialisation  (waits for layout to settle)
     ────────────────────────────────────────────── */

  _initWhenReady(attempts) {
    if (!this._wrap) return;
    const w = this._wrap.clientWidth;
    const h = this._wrap.clientHeight;
    if (w <= 0 || h <= 0) {
      if (attempts < 20) setTimeout(() => this._initWhenReady(attempts + 1), 16);
      return;
    }
    this._svg.setAttribute("width",  w);
    this._svg.setAttribute("height", h);
    this._initCanvas();
  }

  /** Window was resized – update SVG pixel dimensions and re-render the viewport.
      The drawing content (SVG elements) is untouched. */
  _onResize() {
    if (!this._svg || !this._wrap) return;
    const w = this._wrap.clientWidth;
    const h = this._wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    this._svg.setAttribute("width",  w);
    this._svg.setAttribute("height", h);
    this._renderViewport();
  }

  _initCanvas() {
    this._contentGroup.innerHTML = "";
    if (this._erasePaths) this._erasePaths.innerHTML = "";
    this._activePaths = [];
    this._pathDataArr = [];
    this._history     = [];
    this._redoStack   = [];
    this._centerView();
    this._saveHistory();
    this._renderViewport();
    this._updateHistoryInfo();
    this._updateInkInfo();
  }

  /* ──────────────────────────────────────────────
     Viewport  (pan / zoom via SVG viewBox)
     ────────────────────────────────────────────── */

  /** Centre the viewport on the world centre at the current zoom level. */
  _centerView() {
    const w = this._wrap?.clientWidth  ?? 820;
    const h = this._wrap?.clientHeight ?? 600;
    this._viewX = (WORLD_SIZE - w / this._zoom) / 2;
    this._viewY = (WORLD_SIZE - h / this._zoom) / 2;
  }

  /**
   * Update the SVG viewBox to reflect the current pan / zoom state.
   * This is the entire "render" step – no pixel blit needed.
   */
  _renderViewport() {
    if (!this._svg || !this._wrap) return;
    const w  = this._wrap.clientWidth;
    const h  = this._wrap.clientHeight;
    if (!w || !h) return;
    this._svg.setAttribute(
      "viewBox",
      `${this._viewX} ${this._viewY} ${w / this._zoom} ${h / this._zoom}`
    );
    this._updateCenterMarker();
    this._updateZoomInfo();
  }

  /** Keep the CSS crosshair div centred over the symmetry point. */
  _updateCenterMarker() {
    const marker = document.getElementById("fw-draw-center-marker");
    if (!marker) return;
    const scx = Math.round((WORLD_SIZE / 2 - this._viewX) * this._zoom);
    const scy = Math.round((WORLD_SIZE / 2 - this._viewY) * this._zoom);
    marker.style.left = scx + "px";
    marker.style.top  = scy + "px";
  }

  _updateZoomInfo() {
    const el = document.getElementById("fw-draw-zoom-info");
    if (el) el.textContent = `${Math.round(this._zoom * 100)}%`;
  }

  /** Clear all drawing content and erase mask (background rects are permanent and unaffected). */
  _fillBackground() {
    this._doDeselect();
    if (this._contentGroup) this._contentGroup.innerHTML = "";
    if (this._erasePaths)   this._erasePaths.innerHTML   = "";
    // Abort any in-progress stroke
    this._activePaths = [];
    this._pathDataArr = [];
    this._drawing     = false;
  }

  /* ──────────────────────────────────────────────
     Coordinate transform
     ────────────────────────────────────────────── */

  /** Convert a point in SVG pixel space to world coordinates. */
  _screenToWorld(sx, sy) {
    return {
      x: this._viewX + sx / this._zoom,
      y: this._viewY + sy / this._zoom,
    };
  }

  /* ──────────────────────────────────────────────
     Control Bindings
     ────────────────────────────────────────────── */

  _bindControls(html) {
    html.find(".fw-draw-tool-btn[data-tool]").on("click", (e) => {
      this._exitCircleMode();
      this._clearTextInput();
      const prevTool = this._tool;
      const btn = e.currentTarget;
      html.find(".fw-draw-tool-btn[data-tool]").removeClass("active");
      btn.classList.add("active");
      this._tool = btn.dataset.tool;
      this._wrap.className = `fimblewood-draw-canvas-wrap tool-${this._tool}`;
      // Hide eraser cursor immediately when switching away from eraser
      if (this._tool !== "eraser" && this._cursorGroup) {
        this._cursorGroup.setAttribute("visibility", "hidden");
      }
      // Select tool: toggle pointer-events on content so elements are hittable
      if (this._tool === "select") {
        if (this._contentGroup) this._contentGroup.setAttribute("pointer-events", "painted");
      } else {
        if (prevTool === "select" && this._contentGroup) {
          this._contentGroup.setAttribute("pointer-events", "none");
        }
        this._doDeselect();
      }
    });

    html.find("#fw-draw-color-picker").on("input", (e) => {
      this._color = e.currentTarget.value;
    });

    html.find("#fw-draw-brush-size").on("input", (e) => {
      this._brushSize = parseInt(e.currentTarget.value);
      html.find("#fw-draw-brush-size-val").text(this._brushSize);
    });

    html.find("#fw-draw-smooth").on("input", (e) => {
      this._smoothness = parseInt(e.currentTarget.value);
      html.find("#fw-draw-smooth-val").text(this._smoothness);
    });

    html.find("#fw-draw-symmetry").on("change", (e) => {
      this._symmetry = parseInt(e.currentTarget.value);
    });

    html.find("#fw-draw-undo").on("click", () => this._undo());
    html.find("#fw-draw-redo").on("click", () => this._redo());
    html.find("#fw-draw-insert-circle").on("click", () => {
      if (this._insertCircleMode) this._exitCircleMode();
      else this._enterCircleMode();
    });

    html.find("#fw-draw-center-view").on("click", () => {
      this._zoom = 1.0;
      this._centerView();
      this._renderViewport();
    });

    html.find("#fw-draw-clear").on("click", () => {
      this._redoStack = [];
      this._exitCircleMode();
      this._fillBackground();
      this._saveHistory();
      this._updateHistoryInfo();
    this._updateInkInfo();
    });

    html.find("#fw-draw-clipboard").on("click",    () => this._copyToClipboard());
    html.find("#fw-draw-send-chat").on("click",    () => this._sendToChat());
    html.find("#fw-draw-save-gallery").on("click", () => this._saveToGallery());
    html.find("#fw-draw-save").on("click",         () => this._saveImage());
    if (game.user.isGM) {
      html.find("#fw-draw-show-players").on("click", () => this._showToPlayers());
      html.find("#fw-draw-live-draw").on("click",    () => this._toggleLiveDraw());
    }
  }

  /* ──────────────────────────────────────────────
     SVG Event Handling
     ────────────────────────────────────────────── */

  _bindSvgEvents() {
    const el = this._svg;
    el.addEventListener("contextmenu",   (e) => e.preventDefault());
    el.addEventListener("pointerdown",   (e) => this._onPointerDown(e));
    el.addEventListener("pointermove",   (e) => this._onPointerMove(e));
    el.addEventListener("pointerup",     (e) => this._onPointerUp(e));
    el.addEventListener("pointercancel", ()  => {
      this._drawing     = false;
      this._panning     = false;
      this._activePaths = [];
      this._pathDataArr = [];
      this._unmaskPaths = [];
      this._wrap.classList.remove("fw-draw-panning");
    });
    el.addEventListener("pointerleave",  (e) => {
      if (this._drawing) this._onPointerUp(e);
      if (this._panning) {
        this._panning = false;
        this._wrap.classList.remove("fw-draw-panning");
      }
      // Hide the eraser cursor ring when the pointer leaves the canvas
      if (this._cursorGroup) this._cursorGroup.setAttribute("visibility", "hidden");
    });
    el.addEventListener("mousemove",     (e) => {
      this._updateCoords(e);
      if (this._insertCircleMode) this._updateCirclePreview(e);
    });
    el.addEventListener("wheel",         (e) => this._onWheel(e), { passive: false });
  }

  /** Returns the pointer position in SVG pixel space (== screen coords relative to SVG). */
  _canvasPoint(e) {
    const rect = this._svg.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  _updateCoords(e) {
    const sp = this._canvasPoint(e);
    const wp = this._screenToWorld(sp.x, sp.y);
    const el = document.getElementById("fw-draw-coords");
    // Show coords relative to the symmetry centre (world centre = 0,0)
    if (el) el.textContent =
      `x: ${Math.round(wp.x - WORLD_SIZE / 2)}  y: ${Math.round(wp.y - WORLD_SIZE / 2)}`;
  }

  /* ── Zoom ── */

  _onWheel(e) {
    e.preventDefault();
    const factor  = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this._zoom * factor));
    if (newZoom === this._zoom) return;

    // Keep the world-point under the cursor fixed on screen
    const sp     = this._canvasPoint(e);
    this._viewX += sp.x / this._zoom - sp.x / newZoom;
    this._viewY += sp.y / this._zoom - sp.y / newZoom;
    this._zoom   = newZoom;
    this._renderViewport();
  }

  /* ── Pointer events ── */

  _onPointerDown(e) {
    e.preventDefault();

    // ── Insert-circle mode ──────────────────────────────────────────────────
    // Left-click places the circle at the hovered radius; anything else cancels.
    if (this._insertCircleMode) {
      if (e.button === 0) {
        const sp = this._canvasPoint(e);
        const wp = this._screenToWorld(sp.x, sp.y);
        const cx = WORLD_SIZE / 2;
        const cy = WORLD_SIZE / 2;
        const r  = Math.hypot(wp.x - cx, wp.y - cy);
        if (r >= 1) {
          this._redoStack = [];
          const circleEl = this._svgEl("circle", {
            cx:               cx.toFixed(2),
            cy:               cy.toFixed(2),
            r:                r.toFixed(2),
            stroke:           this._color,
            "stroke-width":   this._brushSize,
            "stroke-linecap": "round",
            fill:             "none",
            opacity:          this._opacity,
          });
          this._contentGroup.appendChild(circleEl);
          // White unmask so the circle is visible even over erased areas.
          if (this._erasePaths) {
            const um = circleEl.cloneNode(false);
            um.setAttribute("stroke", "white");
            um.removeAttribute("opacity");
            this._erasePaths.appendChild(um);
          }
          this._saveHistory();
          this._updateHistoryInfo();
    this._updateInkInfo();
        }
      }
      this._exitCircleMode();
      return;
    }

    if (e.button === 2) {
      // Right-click → pan
      this._panning  = true;
      this._panLastX = e.clientX;
      this._panLastY = e.clientY;
      this._svg.setPointerCapture(e.pointerId);
      this._wrap.classList.add("fw-draw-panning");
      return;
    }
    if (e.button !== 0) return;

    // Text tool: place floating input, do not start a stroke
    if (this._tool === "text") {
      const sp = this._canvasPoint(e);
      const wp = this._screenToWorld(sp.x, sp.y);
      this._showTextInput(sp.x, sp.y, wp.x, wp.y);
      return;
    }

    // Select tool: click-to-select / begin drag
    if (this._tool === "select") {
      this._onSelectPointerDown(e);
      return;
    }

    this._svg.setPointerCapture(e.pointerId);
    this._drawing = true;
    const sp = this._canvasPoint(e);
    const wp = this._screenToWorld(sp.x, sp.y);
    // Alt: snap the start point to the grid for shape tools so the whole shape
    // is grid-aligned from the very first point.
    if (e.altKey && ["line", "circle", "rect"].includes(this._tool)) {
      const sg = this._snapToGrid(wp.x, wp.y);
      this._startX = this._lastX = sg.x;
      this._startY = this._lastY = sg.y;
    } else {
      this._startX = this._lastX = wp.x;
      this._startY = this._lastY = wp.y;
    }
    // Initialise the EMA stabiliser at the exact cursor so the first
    // segment starts cleanly regardless of the smoothness setting.
    this._smoothX = wp.x;
    this._smoothY = wp.y;
    this._redoStack = [];

    if (this._tool === "brush" || this._tool === "eraser") {
      const isEraser = this._tool === "eraser";
      this._activePaths = [];
      this._pathDataArr = [];
      this._unmaskPaths = [];

      // Create one <path> element per symmetry axis.
      // "M x y L x y" is a zero-length line; with stroke-linecap="round" it renders
      // as a solid dot — so a simple click (no drag) always leaves a visible mark.
      //
      // Brush  → colored path in _contentGroup.
      //          + matching white path in the erase mask so new drawing is always
      //            visible, even when painted over a previously erased area.
      //            (White = opaque in SVG masks; later mask entries override earlier
      //            ones, so a white brush path always wins over a black erase path.)
      // Eraser → black path in _erasePaths (inside the SVG <mask>).
      //          (Black = transparent in SVG masks = genuine erase.)
      this._withSymmetry(wp.x, wp.y, (cx, cy, tx, ty) => {
        const d = `M ${tx.toFixed(2)} ${ty.toFixed(2)} L ${tx.toFixed(2)} ${ty.toFixed(2)}`;
        const pathEl = this._svgEl("path", isEraser ? {
          stroke:            "black",
          "stroke-width":    this._brushSize,
          "stroke-linecap":  "round",
          "stroke-linejoin": "round",
          fill:              "none",
          d,
        } : {
          stroke:            this._color,
          "stroke-width":    this._brushSize,
          "stroke-linecap":  "round",
          "stroke-linejoin": "round",
          fill:              "none",
          opacity:           this._opacity,
          d,
        });
        const target = isEraser ? this._erasePaths : this._contentGroup;
        target.appendChild(pathEl);
        this._activePaths.push(pathEl);
        this._pathDataArr.push(d);

        // Brush: add a white unmask path to the mask so this stroke remains
        // visible even if it overlaps a black eraser stroke drawn earlier.
        if (!isEraser && this._erasePaths) {
          const unmask = this._svgEl("path", {
            stroke:            "white",
            "stroke-width":    this._brushSize,
            "stroke-linecap":  "round",
            "stroke-linejoin": "round",
            fill:              "none",
            d,
          });
          this._erasePaths.appendChild(unmask);
          this._unmaskPaths.push(unmask);
        } else {
          this._unmaskPaths.push(null);
        }
      });
    }
  }

  _onPointerMove(e) {
    if (this._panning) {
      const dx      = (e.clientX - this._panLastX) / this._zoom;
      const dy      = (e.clientY - this._panLastY) / this._zoom;
      this._viewX  -= dx;
      this._viewY  -= dy;
      this._panLastX = e.clientX;
      this._panLastY = e.clientY;
      this._renderViewport();
      return;
    }
    // Always update eraser cursor (hover + draw)
    const sp = this._canvasPoint(e);
    const wp = this._screenToWorld(sp.x, sp.y);
    this._updateEraserCursor(wp.x, wp.y);

    // Select tool: drag an element or rotation handle
    if (this._tool === "select" && this._selHandle) {
      this._onSelectDrag(wp.x, wp.y, e);
      return;
    }

    if (!this._drawing) return;

    if (this._tool === "brush" || this._tool === "eraser") {
      // EMA stabiliser: alpha=1 → exact cursor; alpha→0 → heavy smoothing
      const alpha    = this._smoothness === 0 ? 1.0 : 1.0 - this._smoothness * 0.09;
      this._smoothX += (wp.x - this._smoothX) * alpha;
      this._smoothY += (wp.y - this._smoothY) * alpha;
      this._extendStroke(this._smoothX, this._smoothY);
      this._lastX = this._smoothX;
      this._lastY = this._smoothY;
      // SVG automatically re-renders when an attribute changes — no explicit redraw.
      if (this._liveDrawing) this._emitLiveThrottled();
    } else {
      // Shape tools: update the live preview group
      const ep = this._constrainEndpoint(this._startX, this._startY, wp.x, wp.y, e.shiftKey, e.ctrlKey, e.altKey);
      this._previewGroup.innerHTML = "";
      this._drawShapeToGroup(this._previewGroup, this._startX, this._startY, ep.x2, ep.y2);
    }
  }

  _onPointerUp(e) {
    if (this._panning) {
      this._panning = false;
      this._wrap.classList.remove("fw-draw-panning");
      return;
    }
    // Select tool: commit the drag (or complete the marquee) and save to history
    if (this._tool === "select" && this._selHandle) {
      const handle = this._selHandle;
      this._selHandle = null;
      this._wrap.classList.remove("fw-draw-sel-moving", "fw-draw-sel-rotating");

      if (handle === "marquee") {
        // Finish rubber-band: collect all elements whose world bbox overlaps the rect
        this._previewGroup.innerHTML = "";
        this._marqueeRect = null;
        const sp  = this._canvasPoint(e);
        const wp  = this._screenToWorld(sp.x, sp.y);
        const rx1 = Math.min(this._selDragStartX, wp.x);
        const ry1 = Math.min(this._selDragStartY, wp.y);
        const rx2 = Math.max(this._selDragStartX, wp.x);
        const ry2 = Math.max(this._selDragStartY, wp.y);
        // Only trigger if the user dragged a real rectangle (not just a mis-click)
        if (rx2 - rx1 > 2 || ry2 - ry1 > 2) {
          const hit = [], bases = [];
          for (const el of Array.from(this._contentGroup.children)) {
            const wbb = this._getWorldBBoxOf(el);
            if (wbb.minX < rx2 && wbb.maxX > rx1 && wbb.minY < ry2 && wbb.maxY > ry1) {
              hit.push(el);
              bases.push(el.getAttribute("transform") || "");
            }
          }
          if (this._marqueeAdditive) {
            // Shift+marquee: union with the existing selection
            for (let i = 0; i < hit.length; i++) {
              if (!this._selectedEls.includes(hit[i])) {
                this._selectedEls.push(hit[i]);
                this._selBaseTransforms.push(bases[i]);
              }
            }
            if (this._selectedEls.length) this._updateSelectionUI();
          } else if (hit.length) {
            this._selectedEls       = hit;
            this._selBaseTransforms = bases;
            this._updateSelectionUI();
          }
        }
        this._marqueeAdditive = false;
        // Marquee never saves history (it's purely a selection operation)
        return;
      }

      // Move or rotate committed — bake new base transforms for next drag
      if (this._selectedEls.length) {
        this._selBaseTransforms = this._selectedEls.map(
          el => el.getAttribute("transform") || ""
        );

        // Append a white unmask clone of each moved/rotated element to _erasePaths
        // so the element remains visible even if it was dragged onto a previously-
        // erased area.  The clone carries the same transform as the element, so it
        // covers the element's actual new visual position.  Because SVG mask entries
        // resolve in DOM order (later wins), this new white entry overrides any black
        // eraser paths that occupy the same region.
        if (this._erasePaths) {
          for (const el of this._selectedEls) {
            const unmask = el.cloneNode(true);
            unmask.setAttribute("stroke", "white");
            // Preserve fill="none" for stroke-only elements; paint everything else white
            const origFill = el.getAttribute("fill");
            unmask.setAttribute("fill", origFill === "none" ? "none" : "white");
            unmask.removeAttribute("opacity");
            this._erasePaths.appendChild(unmask);
          }
        }

        this._saveHistory();
        this._updateHistoryInfo();
    this._updateInkInfo();
        if (this._liveDrawing) this._emitLive();
      }
      return;
    }
    if (!this._drawing) return;
    this._drawing = false;

    const sp = this._canvasPoint(e);
    const wp = this._screenToWorld(sp.x, sp.y);

    if (["line", "circle", "rect"].includes(this._tool)) {
      const ep = this._constrainEndpoint(this._startX, this._startY, wp.x, wp.y, e.shiftKey, e.ctrlKey, e.altKey);
      this._previewGroup.innerHTML = "";
      this._drawShapeToGroup(this._contentGroup, this._startX, this._startY, ep.x2, ep.y2, this._erasePaths);
    } else if ((this._tool === "brush" || this._tool === "eraser") && this._smoothness > 0) {
      // Flush remaining stabiliser lag so the stroke always ends at the exact cursor.
      if (this._lastX !== wp.x || this._lastY !== wp.y) {
        this._extendStroke(wp.x, wp.y);
      }
    }

    this._activePaths = [];
    this._pathDataArr = [];
    this._unmaskPaths = [];
    this._saveHistory();
    this._updateHistoryInfo();
    this._updateInkInfo();
    if (this._liveDrawing) this._emitLive();
  }

  /* ──────────────────────────────────────────────
     Drawing — brush / eraser
     ────────────────────────────────────────────── */

  /**
   * Append a L(ine-to) command to every active path element, extending the
   * stroke to the given world-coordinate point (and its symmetry copies).
   */
  _extendStroke(x2, y2) {
    if (!this._activePaths.length) return;
    let i = 0;
    this._withSymmetry(x2, y2, (cx, cy, tx, ty) => {
      if (!this._activePaths[i]) { i++; return; }
      this._pathDataArr[i] += ` L ${tx.toFixed(2)} ${ty.toFixed(2)}`;
      this._activePaths[i].setAttribute("d", this._pathDataArr[i]);
      // Keep the white unmask path (if any) in sync with the brush stroke.
      if (this._unmaskPaths[i]) {
        this._unmaskPaths[i].setAttribute("d", this._pathDataArr[i]);
      }
      i++;
    });
  }

  /* ──────────────────────────────────────────────
     Drawing — shapes
     ────────────────────────────────────────────── */

  /** Snap a world coordinate to the nearest 20-unit grid point. */
  _snapToGrid(x, y) {
    const g = 20;
    return { x: Math.round(x / g) * g, y: Math.round(y / g) * g };
  }

  /* ──────────────────────────────────────────────
     Select tool
     ────────────────────────────────────────────── */

  /**
   * Pointer-down handler for the select tool.
   * Priority: rotation handle → element hit → start marquee.
   */
  _onSelectPointerDown(e) {
    if (e.button !== 0) return;
    const sp = this._canvasPoint(e);
    const wp = this._screenToWorld(sp.x, sp.y);

    // 1a) Close / delete button
    if (this._selectedEls.length && this._isOnCloseHandle(wp.x, wp.y)) {
      this._deleteSelected();
      return;
    }

    // 1b) Rotation handle (only when something is already selected)
    if (this._selectedEls.length && this._isOnRotateHandle(wp.x, wp.y)) {
      this._selHandle     = "rotate";
      this._selDragStartX = wp.x;
      this._selDragStartY = wp.y;
      // Pivot = centre of the combined world bounding box
      const cbb = this._getCombinedWorldBBox();
      this._selRotCenter = { x: cbb.cx, y: cbb.cy };
      this._wrap.classList.add("fw-draw-sel-rotating");
      this._svg.setPointerCapture(e.pointerId);
      return;
    }

    // 2) Element hit
    const target = this._findSelectTarget(e);
    if (target) {
      if (e.shiftKey) {
        // Shift+click: toggle element in / out of selection (no drag started)
        const idx = this._selectedEls.indexOf(target);
        if (idx >= 0) {
          // Already selected → remove it
          this._selectedEls.splice(idx, 1);
          this._selBaseTransforms.splice(idx, 1);
        } else {
          // Not yet selected → add it
          this._selectedEls.push(target);
          this._selBaseTransforms.push(target.getAttribute("transform") || "");
        }
        this._updateSelectionUI();
        return;   // no drag after a shift-click toggle
      }
      // Normal click: replace selection if this element isn't already in it
      if (!this._selectedEls.includes(target)) {
        this._doDeselect();
        this._doSelectElement(target);
      }
      this._selHandle      = "move";
      this._selDragStartX  = wp.x;
      this._selDragStartY  = wp.y;
      // Capture the selection bbox top-left so Alt-snapping is always relative
      // to the element's own position, not the cursor's click offset.
      const moveCbb = this._getCombinedWorldBBox();
      this._selRefWorldPos = { x: moveCbb.minX, y: moveCbb.minY };
      this._wrap.classList.add("fw-draw-sel-moving");
      this._svg.setPointerCapture(e.pointerId);
    } else {
      // 3) Empty canvas
      if (e.shiftKey) {
        // Shift+drag on empty space: start an additive marquee (keeps current selection)
        this._selHandle       = "marquee";
        this._selDragStartX   = wp.x;
        this._selDragStartY   = wp.y;
        this._marqueeRect     = null;
        this._marqueeAdditive = true;
        this._svg.setPointerCapture(e.pointerId);
      } else {
        // Normal click/drag on empty → clear selection and begin a fresh marquee
        this._doDeselect();
        this._selHandle       = "marquee";
        this._selDragStartX   = wp.x;
        this._selDragStartY   = wp.y;
        this._marqueeRect     = null;
        this._marqueeAdditive = false;
        this._svg.setPointerCapture(e.pointerId);
      }
    }
  }

  /**
   * Process a drag move while a select-tool handle is active.
   * Handles move, rotate, and marquee rubber-band.
   *
   * Modifier keys during move:
   *   Ctrl — constrain translation direction to the nearest 45° increment
   *   Alt  — snap the cursor position to the 20-unit grid
   * Modifier keys during rotate:
   *   Ctrl — snap rotation angle to the nearest 45° increment
   */
  _onSelectDrag(worldX, worldY, e = {}) {
    if (this._selHandle === "marquee") {
      // Draw rubber-band rectangle in preview group
      const x1 = Math.min(this._selDragStartX, worldX);
      const y1 = Math.min(this._selDragStartY, worldY);
      const x2 = Math.max(this._selDragStartX, worldX);
      const y2 = Math.max(this._selDragStartY, worldY);
      if (!this._marqueeRect) {
        this._marqueeRect = this._svgEl("rect", {
          fill:              "rgba(80,160,255,0.08)",
          stroke:            "rgba(80,160,255,0.7)",
          "stroke-width":    "1",
          "stroke-dasharray":"4 2",
          "vector-effect":   "non-scaling-stroke",
          "pointer-events":  "none",
        });
        this._previewGroup.appendChild(this._marqueeRect);
      }
      this._marqueeRect.setAttribute("x",      x1.toFixed(2));
      this._marqueeRect.setAttribute("y",      y1.toFixed(2));
      this._marqueeRect.setAttribute("width",  Math.max(0, x2 - x1).toFixed(2));
      this._marqueeRect.setAttribute("height", Math.max(0, y2 - y1).toFixed(2));
      return;
    }

    if (!this._selectedEls.length) return;

    if (this._selHandle === "move") {
      let dx = worldX - this._selDragStartX;
      let dy = worldY - this._selDragStartY;

      // Alt: snap the selection's bounding-box top-left to the nearest grid point.
      // Using the element's own reference position (captured at drag-start) instead
      // of the cursor means the snap target is always the same regardless of where
      // inside the element the user clicked.
      if (e.altKey && this._selRefWorldPos) {
        const g       = 20;
        const newRefX = this._selRefWorldPos.x + dx;
        const newRefY = this._selRefWorldPos.y + dy;
        dx = Math.round(newRefX / g) * g - this._selRefWorldPos.x;
        dy = Math.round(newRefY / g) * g - this._selRefWorldPos.y;
      }
      // Ctrl: constrain direction to nearest 45° (cardinal + diagonal)
      if (e.ctrlKey) {
        const dist = Math.hypot(dx, dy);
        if (dist > 0) {
          const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          dx = dist * Math.cos(snapped);
          dy = dist * Math.sin(snapped);
        }
      }

      for (let i = 0; i < this._selectedEls.length; i++) {
        const base = this._selBaseTransforms[i];
        this._selectedEls[i].setAttribute("transform",
          `translate(${dx.toFixed(2)},${dy.toFixed(2)})${base ? " " + base : ""}`
        );
      }

    } else if (this._selHandle === "rotate" && this._selRotCenter) {
      const { x: cx, y: cy } = this._selRotCenter;
      const startAngle   = Math.atan2(this._selDragStartY - cy, this._selDragStartX - cx);
      const currentAngle = Math.atan2(worldY - cy, worldX - cx);
      let delta = (currentAngle - startAngle) * (180 / Math.PI);

      // Ctrl: snap rotation to nearest 45°
      if (e.ctrlKey) delta = Math.round(delta / 45) * 45;

      for (let i = 0; i < this._selectedEls.length; i++) {
        const base = this._selBaseTransforms[i];
        this._selectedEls[i].setAttribute("transform",
          `rotate(${delta.toFixed(3)},${cx.toFixed(2)},${cy.toFixed(2)})${base ? " " + base : ""}`
        );
      }
    }

    this._updateSelectionUI();
  }

  /**
   * Walk up from the pointer-event target to find the first direct child of
   * _contentGroup that was hit (the topmost selectable element).
   */
  _findSelectTarget(e) {
    let el = e.target;
    if (!el || !this._contentGroup) return null;
    while (el && el.parentNode !== this._contentGroup) {
      el = el.parentNode;
      if (!el || el === this._svg) return null;
    }
    return el;
  }

  /**
   * Set a single element as the selection and refresh the UI overlay.
   */
  _doSelectElement(el) {
    this._selectedEls       = [el];
    this._selBaseTransforms = [el.getAttribute("transform") || ""];
    this._updateSelectionUI();
  }

  /**
   * Clear all selection state and remove the UI overlay.
   */
  _doDeselect() {
    this._selectedEls        = [];
    this._selBaseTransforms  = [];
    this._selHandle          = null;
    this._selRotCenter        = null;
    this._selRotHandleWorld   = null;
    this._selCloseHandleWorld = null;
    this._marqueeRect         = null;
    this._marqueeAdditive    = false;
    this._selRefWorldPos     = null;
    if (this._wrap) this._wrap.classList.remove("fw-draw-sel-moving", "fw-draw-sel-rotating");
    if (this._previewGroup) this._previewGroup.innerHTML = "";
  }

  /**
   * Compute the world-space axis-aligned bounding box of a single SVG element,
   * accounting for all transforms applied to it via _elementLocalToWorld.
   */
  _getWorldBBoxOf(el) {
    const bb = el.getBBox();
    const corners = [
      [bb.x,              bb.y             ],
      [bb.x + bb.width,   bb.y             ],
      [bb.x + bb.width,   bb.y + bb.height ],
      [bb.x,              bb.y + bb.height ],
    ].map(([x, y]) => this._elementLocalToWorld(el, x, y));
    const xs = corners.map(p => p.x);
    const ys = corners.map(p => p.y);
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  }

  /**
   * Return the union of world-space bounding boxes of all selected elements,
   * plus a convenience cx/cy centre point.
   */
  _getCombinedWorldBBox() {
    let minX =  Infinity, minY =  Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const el of this._selectedEls) {
      const wbb = this._getWorldBBoxOf(el);
      if (wbb.minX < minX) minX = wbb.minX;
      if (wbb.minY < minY) minY = wbb.minY;
      if (wbb.maxX > maxX) maxX = wbb.maxX;
      if (wbb.maxY > maxY) maxY = wbb.maxY;
    }
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  /**
   * Map a point from an element's local coordinate space to SVG world space.
   * Walks up the ancestor chain composing SVGMatrix transforms until it reaches
   * _contentGroup (whose coordinate space is world space since it has no transform).
   */
  _elementLocalToWorld(el, localX, localY) {
    const svgPt = this._svg.createSVGPoint();
    svgPt.x = localX;
    svgPt.y = localY;
    let cur  = svgPt;
    let node = el;
    while (node && node !== this._contentGroup) {
      if (node.transform && node.transform.baseVal.numberOfItems > 0) {
        const consolidated = node.transform.baseVal.consolidate();
        if (consolidated) {
          const tmp = this._svg.createSVGPoint();
          tmp.x = cur.x;
          tmp.y = cur.y;
          cur = tmp.matrixTransform(consolidated.matrix);
        }
      }
      node = node.parentNode;
      if (!node) break;
    }
    return { x: cur.x, y: cur.y };
  }

  /**
   * Rotation handle visual radius in world units — stays ~14 px on screen
   * at all zoom levels.
   */
  _getHandleWorldRadius() {
    const w = this._wrap ? this._wrap.clientWidth : WORLD_SIZE;
    return 14 * (WORLD_SIZE / w) / Math.max(0.01, this._zoom);
  }

  /**
   * True if world-space point (wx, wy) is within the rotation handle's hit area
   * (1.8× the visual radius for comfortable clicking).
   */
  _isOnRotateHandle(wx, wy) {
    if (!this._selRotHandleWorld) return false;
    const r  = this._getHandleWorldRadius() * 1.8;
    const dx = wx - this._selRotHandleWorld.x;
    const dy = wy - this._selRotHandleWorld.y;
    return dx * dx + dy * dy <= r * r;
  }

  /** True if (wx, wy) hits the close/delete button. */
  _isOnCloseHandle(wx, wy) {
    if (!this._selCloseHandleWorld) return false;
    // Must match the visual circle radius drawn in _updateSelectionUI (hR * 0.45)
    const r  = this._getHandleWorldRadius() * 0.45;
    const dx = wx - this._selCloseHandleWorld.x;
    const dy = wy - this._selCloseHandleWorld.y;
    return dx * dx + dy * dy <= r * r;
  }

  /**
   * Delete all currently selected elements and save to history.
   */
  _deleteSelected() {
    if (!this._selectedEls.length) return;
    for (const el of this._selectedEls) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    this._doDeselect();
    this._saveHistory();
    this._updateHistoryInfo();
    this._updateInkInfo();
    if (this._liveDrawing) this._emitLive();
  }

  /**
   * Rebuild the selection overlay in _previewGroup.
   *
   * - One dashed box per selected element (drawn in the element's own local
   *   coordinate space so it follows any rotation / translation transforms).
   * - A single rotation handle positioned above the combined world bounding box.
   */
  _updateSelectionUI() {
    if (!this._previewGroup) return;
    this._previewGroup.innerHTML = "";
    if (!this._selectedEls.length) return;

    const hR  = this._getHandleWorldRadius();
    const pad = Math.max(6, hR * 0.75);

    // Per-element dashed bounding boxes (in each element's local transform space)
    for (const el of this._selectedEls) {
      const bb        = el.getBBox();
      const transform = el.getAttribute("transform") || "";
      const group     = this._svgEl("g", transform ? { transform } : {});
      group.appendChild(this._svgEl("rect", {
        x:                 bb.x - pad,
        y:                 bb.y - pad,
        width:             (bb.width  || 0) + 2 * pad,
        height:            (bb.height || 0) + 2 * pad,
        fill:              "rgba(80,160,255,0.06)",
        stroke:            "rgba(80,160,255,0.85)",
        "stroke-width":    "1.5",
        "stroke-dasharray":"6 3",
        "vector-effect":   "non-scaling-stroke",
        "pointer-events":  "none",
      }));
      this._previewGroup.appendChild(group);
    }

    // Single rotation handle above the combined world bounding box (world space)
    const cbb  = this._getCombinedWorldBBox();
    const rhWx = cbb.cx;
    const rhWy = cbb.minY - hR * 3.2;

    this._previewGroup.appendChild(this._svgEl("line", {
      x1: rhWx, y1: cbb.minY,
      x2: rhWx, y2: rhWy + hR,
      stroke:           "rgba(80,160,255,0.65)",
      "stroke-width":   "1",
      "vector-effect":  "non-scaling-stroke",
      "pointer-events": "none",
    }));

    this._previewGroup.appendChild(this._svgEl("circle", {
      cx: rhWx, cy: rhWy, r: hR,
      fill:             "rgba(80,160,255,0.22)",
      stroke:           "rgba(80,160,255,0.90)",
      "stroke-width":   "1.5",
      "vector-effect":  "non-scaling-stroke",
      "pointer-events": "none",
    }));

    this._selRotHandleWorld = { x: rhWx, y: rhWy };

    // Close / delete button — small red ✕ at the top-right corner of the combined bbox
    const cbx = cbb.maxX + hR * 0.5;
    const cby = cbb.minY - hR * 0.5;
    const closeR = hR * 0.45;          // visual circle radius — noticeably smaller than hR
    const arm    = closeR * 0.55;      // half-length of each ✕ arm

    this._previewGroup.appendChild(this._svgEl("circle", {
      cx: cbx, cy: cby, r: closeR,
      fill:             "rgba(200,50,50,0.85)",
      stroke:           "rgba(255,140,140,0.90)",
      "stroke-width":   "1",
      "vector-effect":  "non-scaling-stroke",
      "pointer-events": "none",
    }));
    this._previewGroup.appendChild(this._svgEl("line", {
      x1: cbx - arm, y1: cby - arm, x2: cbx + arm, y2: cby + arm,
      stroke: "white", "stroke-width": "1.5",
      "stroke-linecap": "round",
      "vector-effect": "non-scaling-stroke", "pointer-events": "none",
    }));
    this._previewGroup.appendChild(this._svgEl("line", {
      x1: cbx + arm, y1: cby - arm, x2: cbx - arm, y2: cby + arm,
      stroke: "white", "stroke-width": "1.5",
      "stroke-linecap": "round",
      "vector-effect": "non-scaling-stroke", "pointer-events": "none",
    }));

    this._selCloseHandleWorld = { x: cbx, y: cby };
  }

  /**
   * Show or hide the eraser cursor ring.
   * Called on every pointer-move so the ring always tracks the cursor.
   * The ring radius equals half the current brush size (the eraser stroke-width).
   */
  _updateEraserCursor(worldX, worldY) {
    if (!this._cursorGroup) return;
    if (this._tool !== "eraser") {
      this._cursorGroup.setAttribute("visibility", "hidden");
      return;
    }
    const r = this._brushSize / 2;
    const cx = worldX.toFixed(1);
    const cy = worldY.toFixed(1);
    for (const el of [this._cursorOuter, this._cursorInner]) {
      el.setAttribute("cx", cx);
      el.setAttribute("cy", cy);
      el.setAttribute("r",  r);
    }
    this._cursorGroup.setAttribute("visibility", "visible");
  }

  /**
   * Apply modifier-key constraints to a shape endpoint before drawing.
   *
   * Alt   — snap the endpoint to the nearest 20-unit grid point (same grid
   *         shown on screen).  Works for all shape tools.
   * Ctrl  — snap the direction from (x1,y1) to (x2,y2) to the nearest 45°
   *         increment (0°, 45°, 90°, 135°, …).  Works for all shape tools.
   * Shift — lock to equal dimensions so rect → square, ellipse → circle.
   *         Applies to "circle" and "rect" only; ignored for "line".
   *
   * Constraints are applied in order: Alt first (grid snap), Ctrl next
   * (direction snap), then Shift (equalise magnitudes).
   */
  _constrainEndpoint(x1, y1, x2, y2, shift, ctrl, alt) {
    let ex = x2, ey = y2;

    if (alt) {
      const sg = this._snapToGrid(ex, ey);
      ex = sg.x;
      ey = sg.y;
    }

    let dx = ex - x1, dy = ey - y1;

    if (ctrl) {
      const r = Math.hypot(dx, dy);
      if (r > 0) {
        const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        dx = r * Math.cos(snapped);
        dy = r * Math.sin(snapped);
      }
    }

    if (shift && (this._tool === "circle" || this._tool === "rect")) {
      const s = Math.min(Math.abs(dx), Math.abs(dy));
      dx = (dx >= 0 ? 1 : -1) * s;
      dy = (dy >= 0 ? 1 : -1) * s;
    }

    return { x2: x1 + dx, y2: y1 + dy };
  }

  /**
   * Create SVG shape elements for the current tool (line / circle / rect) and
   * append them to `group`.  Respects symmetry — creates one element per axis.
   *
   * Symmetry is applied by building the i=0 shape in world coordinates and then
   * rotating the whole element around the world centre for each subsequent copy.
   * This is correct for all tools:
   *   • line   — rotating two endpoints is equivalent to rotating the whole line ✓
   *   • ellipse — rotates the shape intact; the old approach of rotating the two
   *               bounding-box corners and recomputing rx/ry gave wrong sizes
   *               at non-axis-aligned angles (visible as distortion at 6/8/12-fold)
   *   • rect   — same issue; a `transform="rotate(…)"` rect renders correctly as
   *               a rotated rectangle rather than a mis-sized axis-aligned one
   *
   * @param {SVGElement} unmaskGroup - Optional. When provided (pass `_erasePaths`),
   *   white copies of each shape are also appended here so the shapes remain visible
   *   even if drawn over previously erased areas.
   */
  _drawShapeToGroup(group, x1, y1, x2, y2, unmaskGroup = null) {
    const wcx  = WORLD_SIZE / 2;
    const wcy  = WORLD_SIZE / 2;
    const step = (Math.PI * 2) / this._symmetry;

    const base = {
      stroke:            this._color,
      "stroke-width":    this._brushSize,
      "stroke-linecap":  "round",
      "stroke-linejoin": "round",
      fill:              "none",
      opacity:           this._opacity,
    };

    // Build the prototype element (i = 0, no rotation).
    let proto;
    if (this._tool === "line") {
      proto = this._svgEl("line", {
        ...base,
        x1: x1.toFixed(2),  y1: y1.toFixed(2),
        x2: x2.toFixed(2),  y2: y2.toFixed(2),
      });
    } else if (this._tool === "circle") {
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      proto = this._svgEl("ellipse", {
        ...base,
        cx: ((x1 + x2) / 2).toFixed(2),
        cy: ((y1 + y2) / 2).toFixed(2),
        rx: (rx || 1).toFixed(2),
        ry: (ry || 1).toFixed(2),
      });
    } else if (this._tool === "rect") {
      proto = this._svgEl("rect", {
        ...base,
        x:      Math.min(x1, x2).toFixed(2),
        y:      Math.min(y1, y2).toFixed(2),
        width:  Math.abs(x2 - x1).toFixed(2),
        height: Math.abs(y2 - y1).toFixed(2),
      });
    }
    if (!proto) return;

    // Stamp one copy per symmetry axis, rotating around the world centre.
    for (let i = 0; i < this._symmetry; i++) {
      const copy = i === 0 ? proto : proto.cloneNode(false);
      if (i > 0) {
        const deg = (step * i * 180 / Math.PI).toFixed(4);
        copy.setAttribute("transform", `rotate(${deg} ${wcx} ${wcy})`);
      }
      group.appendChild(copy);
    }

    // White unmask copies: stamp matching shapes into the erase mask so these
    // shapes remain visible even if drawn over a previously erased area.
    if (unmaskGroup) {
      for (let i = 0; i < this._symmetry; i++) {
        const mc = proto.cloneNode(false);
        mc.setAttribute("stroke", "white");
        mc.setAttribute("opacity", "1");
        if (i > 0) {
          const deg = (step * i * 180 / Math.PI).toFixed(4);
          mc.setAttribute("transform", `rotate(${deg} ${wcx} ${wcy})`);
        }
        unmaskGroup.appendChild(mc);
      }
    }
  }

  /* ──────────────────────────────────────────────
     Insert-circle mode
     Press the button → cursor becomes a radius picker; hover shows a live
     preview circle centred on the world centre; click to place it.
     ────────────────────────────────────────────── */

  _enterCircleMode() {
    this._insertCircleMode = true;
    this._previewGroup.innerHTML = "";
    this._wrap.classList.add("fw-draw-insert-circle-mode");
    document.getElementById("fw-draw-insert-circle")?.classList.add("active");
  }

  _exitCircleMode() {
    if (!this._insertCircleMode) return;
    this._insertCircleMode = false;
    this._previewGroup.innerHTML = "";
    this._wrap.classList.remove("fw-draw-insert-circle-mode");
    document.getElementById("fw-draw-insert-circle")?.classList.remove("active");
  }

  /** Redraw the preview circle in `_previewGroup` based on cursor distance from world centre. */
  _updateCirclePreview(e) {
    const sp = this._canvasPoint(e);
    const wp = this._screenToWorld(sp.x, sp.y);
    const cx = WORLD_SIZE / 2;
    const cy = WORLD_SIZE / 2;
    const r  = Math.hypot(wp.x - cx, wp.y - cy);

    this._previewGroup.innerHTML = "";
    if (r < 1) return;

    this._previewGroup.appendChild(this._svgEl("circle", {
      cx:               cx.toFixed(2),
      cy:               cy.toFixed(2),
      r:                r.toFixed(2),
      stroke:           this._color,
      "stroke-width":   this._brushSize,
      "stroke-linecap": "round",
      fill:             "none",
      opacity:          this._opacity,
    }));
  }

  /* ──────────────────────────────────────────────
     Symmetry
     ────────────────────────────────────────────── */

  /**
   * Call fn(cx, cy, tx, ty, i) for each symmetry copy of (x, y).
   * i = 0 is the original position; i = 1..N-1 are rotated copies.
   * The symmetry centre is always the world centre — it never drifts.
   */
  _withSymmetry(x, y, fn) {
    const cx        = WORLD_SIZE / 2;
    const cy        = WORLD_SIZE / 2;
    const dx        = x - cx,  dy = y - cy;
    const baseAngle = Math.atan2(dy, dx);
    const r         = Math.hypot(dx, dy);
    const step      = (Math.PI * 2) / this._symmetry;
    for (let i = 0; i < this._symmetry; i++) {
      const angle = baseAngle + step * i;
      fn(cx, cy, cx + r * Math.cos(angle), cy + r * Math.sin(angle), i);
    }
  }

  /* ──────────────────────────────────────────────
     History (Undo / Redo)
     ────────────────────────────────────────────── */

  /**
   * Snapshot the current drawing content AND erase mask.
   * Each snapshot is a {draw, erase} pair of cloned SVG node arrays —
   * far smaller than the 16 MB ImageData snapshots of the old canvas approach.
   */
  _saveHistory() {
    if (!this._contentGroup) return;
    const snap = {
      draw:  Array.from(this._contentGroup.children).map(n => n.cloneNode(true)),
      erase: Array.from(this._erasePaths?.children ?? []).map(n => n.cloneNode(true)),
    };
    this._history.push(snap);
    if (this._history.length > MAX_HISTORY) this._history.shift();
    this._updateHistoryInfo();
    this._updateInkInfo();
  }

  _restoreSnapshot(snap) {
    this._contentGroup.innerHTML = "";
    for (const node of snap.draw)  this._contentGroup.appendChild(node.cloneNode(true));
    if (this._erasePaths) {
      this._erasePaths.innerHTML = "";
      for (const node of snap.erase) this._erasePaths.appendChild(node.cloneNode(true));
    }
  }

  _undo() {
    this._doDeselect();
    if (this._history.length <= 1) return;
    this._redoStack.push(this._history.pop());
    this._restoreSnapshot(this._history[this._history.length - 1]);
    this._updateHistoryInfo();
    this._updateInkInfo();
  }

  _redo() {
    this._doDeselect();
    if (!this._redoStack.length) return;
    const snap = this._redoStack.pop();
    this._history.push(snap);
    this._restoreSnapshot(snap);
    this._updateHistoryInfo();
    this._updateInkInfo();
  }

  _updateHistoryInfo() {
    const el = document.getElementById("fw-draw-history-info");
    if (el) el.textContent = `Undo: ${this._history.length - 1}  Redo: ${this._redoStack.length}`;
  }

  /**
   * Calculate total "ink used": the sum of stroke lengths for every drawn
   * element in _contentGroup (stroke width is ignored), divided by 1000 —
   * i.e. one ink unit equals 1000 world-units of stroke length. This puts
   * typical drawings on the 0-25 scale used by the spell-level thresholds.
   */
  _calcInkUsed() {
    if (!this._contentGroup) return 0;
    let total = 0;
    for (const el of this._contentGroup.children) {
      try {
        const strokeVal = el.getAttribute("stroke");
        const hasStroke = strokeVal && strokeVal !== "none";
        if (hasStroke && typeof el.getTotalLength === "function") {
          total += el.getTotalLength();
        }
      } catch (_) { /* skip degenerate elements */ }
    }
    return total / 1000;
  }

  /**
   * Map an ink amount to a spell level (0 = cantrip … 9 = ninth level).
   * Returns 10 for anything at or above the ninth-level cap (overspent).
   */
  _spellLevelForInk(ink) {
    const caps = [3, 8, 12, 15, 17, 19, 20, 21, 22, 23]; // upper bound (exclusive) per level 0-9
    for (let lvl = 0; lvl < caps.length; lvl++) {
      if (ink < caps[lvl]) return lvl;
    }
    return 10;
  }

  _updateInkInfo() {
    const inkEl   = document.getElementById("fw-draw-ink-info");
    const levelEl = document.getElementById("fw-draw-spell-level");
    const ink = this._calcInkUsed();

    if (inkEl) inkEl.textContent = `\u{1F58B} ${ink.toFixed(1)}`;

    if (levelEl) {
      if (ink <= 0) {
        levelEl.style.display = "none";
      } else {
        levelEl.style.display = "";
        const lvl = this._spellLevelForInk(ink);
        levelEl.textContent = lvl === 0  ? game.i18n.localize("FIMBLEWOOD.Draw.Status.Cantrip")
                            : lvl === 10 ? game.i18n.localize("FIMBLEWOOD.Draw.Status.BeyondNinth")
                            : game.i18n.format("FIMBLEWOOD.Draw.Status.SpellLevel", { level: lvl });
        levelEl.classList.toggle("fw-draw-level-max", lvl === 10);
      }
    }
  }

  /* ──────────────────────────────────────────────
     Export
     ────────────────────────────────────────────── */

  /**
   * Compute a square SVG viewBox that is tightly fitted around the drawing
   * content, with `padding` world-units of breathing room on each side.
   *
   * Using a square viewBox means magic circles (which are round) appear
   * correctly in the gallery thumbnail regardless of the container's aspect
   * ratio.  Falls back to the full world viewBox when the canvas is empty or
   * getBBox() is unavailable.
   *
   * @param {number} [padding=60] - World-space margin added on every side.
   */
  _tightViewBox(padding = 60) {
    try {
      if (!this._contentGroup?.children.length) throw new Error("empty");
      const bb = this._contentGroup.getBBox();
      if (!bb.width && !bb.height) throw new Error("zero");
      const cx   = bb.x + bb.width  / 2;
      const cy   = bb.y + bb.height / 2;
      const half = Math.max(bb.width, bb.height) / 2 + padding;
      return `${(cx - half).toFixed(2)} ${(cy - half).toFixed(2)}`
           + ` ${(half * 2).toFixed(2)} ${(half * 2).toFixed(2)}`;
    } catch {
      return `0 0 ${WORLD_SIZE} ${WORLD_SIZE}`;
    }
  }

  /**
   * Return a deep clone of the SVG prepared for export:
   *  - viewBox covers the full 2000×2000 world
   *  - preview group is empty
   *  - grid overlay is removed (it is an editing aid, not part of the drawing)
   */
  _cloneForExport(width = WORLD_SIZE, height = WORLD_SIZE) {
    this._previewGroup.innerHTML = "";
    const clone = this._svg.cloneNode(true);
    clone.setAttribute("viewBox", `0 0 ${WORLD_SIZE} ${WORLD_SIZE}`);
    clone.setAttribute("width",   width);
    clone.setAttribute("height",  height);
    clone.querySelector("#fw-draw-grid-overlay")?.remove();
    return clone;
  }

  /**
   * Render the full 2000×2000 world to an offscreen <canvas> and return it.
   * We clone the SVG instead of mutating the live element to avoid a visual flash.
   */
  async _rasterize(width = WORLD_SIZE, height = WORLD_SIZE) {
    const clone  = this._cloneForExport(width, height);
    const svgStr = new XMLSerializer().serializeToString(clone);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
    });
  }

  async _copyToClipboard() {
    let canvas;
    try {
      canvas = await this._rasterize();
    } catch (err) {
      console.warn(`${MODULE_ID} | rasterize for clipboard failed:`, err);
      ui.notifications.warn("Fimblewood Academy: could not rasterise SVG for clipboard.");
      return;
    }

    const hasClipboard = typeof navigator !== "undefined" &&
                         navigator.clipboard &&
                         typeof ClipboardItem !== "undefined" &&
                         window.isSecureContext;
    if (hasClipboard) {
      try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        ui.notifications.info(game.i18n.localize("FIMBLEWOOD.Draw.Actions.CopiedClipboard"));
        return;
      } catch (err) {
        console.warn(`${MODULE_ID} | clipboard write failed, falling back:`, err);
      }
    }

    const dataUrl = canvas.toDataURL("image/png");
    const win = window.open();
    if (win) {
      win.document.write(
        `<img src="${dataUrl}" style="max-width:100%;background:#888"
              title="Rechtsklick → Bild kopieren / Right-click → Copy Image">`
      );
      ui.notifications.info(game.i18n.localize("FIMBLEWOOD.Draw.Actions.CopyFallback"));
    } else {
      ui.notifications.warn(game.i18n.localize("FIMBLEWOOD.Draw.Actions.CopyFailed"));
    }
  }

  /**
   * Rasterise the drawing and post it as a chat message visible to everyone.
   * Uses a 600×600 tight-cropped PNG so the image is compact but clear.
   */
  async _sendToChat() {
    let canvas;
    try {
      const clone = this._cloneForExport(600, 600);
      clone.setAttribute("viewBox", this._tightViewBox());
      const svgStr = new XMLSerializer().serializeToString(clone);
      canvas = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = 600; c.height = 600;
          c.getContext("2d").drawImage(img, 0, 0, 600, 600);
          resolve(c);
        };
        img.onerror = reject;
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | rasterize for chat failed:`, err);
      ui.notifications.warn("Fimblewood Academy: could not prepare image for chat.");
      return;
    }

    const dataUrl = canvas.toDataURL("image/png");
    await ChatMessage.create({
      content: `<img src="${dataUrl}" style="max-width:100%;border-radius:4px;display:block">`,
      speaker: ChatMessage.getSpeaker(),
    });
  }

  async _showToPlayers() {
    if (!game.user.isGM) return;
    let canvas;
    try {
      canvas = await this._rasterize();
    } catch (err) {
      console.warn(`${MODULE_ID} | rasterize for players failed:`, err);
      ui.notifications.warn("Fimblewood Academy: could not prepare image for players.");
      return;
    }
    const src   = canvas.toDataURL("image/png");
    const title = game.i18n.localize("FIMBLEWOOD.Draw.WindowTitle");
    new ImagePopout(src, { window: { title }, shareable: false }).render(true);
    game.socket.emit(`module.${MODULE_ID}`, { type: "showImage", src, title });
  }

  // ── Text tool ──

  _showTextInput(screenX, screenY, worldX, worldY) {
    this._clearTextInput();

    // Estimate screen-pixel font size so the input looks like the SVG text will
    const fontSize       = Math.max(20, this._brushSize * 8);
    const screenFontSize = Math.max(14, Math.min(56,
      fontSize * this._wrap.clientWidth * this._zoom / WORLD_SIZE));

    const wrap  = document.createElement("div");
    wrap.className = "fw-draw-text-input-wrap";
    wrap.style.left = `${screenX}px`;
    wrap.style.top  = `${screenY}px`;

    const input = document.createElement("input");
    input.type        = "text";
    input.className   = "fw-draw-text-input";
    input.placeholder = "Type & press Enter…";
    input.style.fontSize = `${screenFontSize}px`;
    wrap.appendChild(input);
    this._wrap.appendChild(wrap);
    this._textInputWrap = wrap;

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const val = input.value;
      wrap.remove();
      this._textInputWrap = null;
      if (val.trim()) this._commitText(worldX, worldY, val.trim());
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      wrap.remove();
      this._textInputWrap = null;
    };

    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();           // don't trigger Ctrl+Z etc.
      if (ev.key === "Enter")  { ev.preventDefault(); commit(); }
      if (ev.key === "Escape") { cancel(); }
    });
    input.addEventListener("blur", commit);
    setTimeout(() => input.focus(), 0);
  }

  _clearTextInput() {
    if (this._textInputWrap) {
      this._textInputWrap.remove();
      this._textInputWrap = null;
    }
  }

  _commitText(worldX, worldY, text) {
    if (!text) return;
    const fontSize = Math.max(20, this._brushSize * 8);
    const step     = (2 * Math.PI) / this._symmetry;
    const wcx      = WORLD_SIZE / 2;
    const wcy      = WORLD_SIZE / 2;

    // Build prototype text element at the clicked world position
    const proto = this._svgEl("text", {
      x:                   worldX.toFixed(2),
      y:                   worldY.toFixed(2),
      fill:                this._color,
      "font-size":         fontSize,
      "font-family":       '"Palatino Linotype", Palatino, "Book Antiqua", serif',
      "text-anchor":       "middle",
      "dominant-baseline": "middle",
      opacity:             this._opacity,
    });
    proto.textContent = text;

    for (let i = 0; i < this._symmetry; i++) {
      const copy = proto.cloneNode(true);
      if (i > 0) {
        const deg = (step * i * 180 / Math.PI).toFixed(4);
        copy.setAttribute("transform", `rotate(${deg} ${wcx} ${wcy})`);
      }
      this._contentGroup.appendChild(copy);

      // White unmask copy so text remains visible over erased areas
      if (this._erasePaths) {
        const um = copy.cloneNode(true);
        um.setAttribute("fill", "white");
        um.removeAttribute("opacity");
        this._erasePaths.appendChild(um);
      }
    }

    this._saveHistory();
    this._updateHistoryInfo();
    this._updateInkInfo();
    if (this._liveDrawing) this._emitLive();
  }

  // ── Live-draw broadcast (GM only) ──

  _toggleLiveDraw() {
    if (!game.user.isGM) return;
    this._liveDrawing = !this._liveDrawing;
    const btn = document.getElementById("fw-draw-live-draw");
    if (btn) btn.classList.toggle("fw-draw-live-active", this._liveDrawing);

    if (this._liveDrawing) {
      // Tell all player clients to open their viewer, then send current state
      game.socket.emit(`module.${MODULE_ID}`, {
        type:   "liveDrawingStart",
        gmName: game.user.name,
      });
      this._emitLive();
    } else {
      game.socket.emit(`module.${MODULE_ID}`, { type: "liveDrawingStop" });
    }
  }

  _emitLive() {
    if (!this._contentGroup) return;
    this._lastLiveEmit = Date.now();
    game.socket.emit(`module.${MODULE_ID}`, {
      type:          "liveDrawing",
      contentHtml:   this._contentGroup.innerHTML,
      eraseMaskHtml: this._erasePaths?.innerHTML ?? "",
      viewBox:       this._tightViewBox(80),
      gmName:        game.user.name,
    });
  }

  _emitLiveThrottled() {
    if (Date.now() - this._lastLiveEmit >= 200) this._emitLive();
  }

  /** Download the drawing as a true .svg file (infinite resolution). */
  _saveImage() {
    const clone  = this._cloneForExport();
    clone.setAttribute("viewBox", this._tightViewBox());
    const svgStr = new XMLSerializer().serializeToString(clone);
    const blob   = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const link   = document.createElement("a");
    link.download = `magic-circle-${Date.now()}.svg`;
    link.href     = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async _saveToGallery() {
    const name = await _promptName(
      game.i18n.localize("FIMBLEWOOD.Draw.Gallery.NameTitle"), ""
    );
    if (name === null) return;
    const trimmed = name.trim() || game.i18n.localize("FIMBLEWOOD.Draw.Gallery.Unnamed");

    // Store the raw SVG content HTML for lossless editing (no re-encoding round-trip).
    const contentHtml   = this._contentGroup.innerHTML;
    const eraseMaskHtml = this._erasePaths?.innerHTML ?? "";

    // Build a tight-cropped SVG data URL for the gallery thumbnail.
    // _tightViewBox() computes a square viewBox around the actual content so
    // even small drawings fill the thumbnail instead of appearing as a dot in
    // the middle of the parchment.  Grid is excluded by _cloneForExport().
    const clone   = this._cloneForExport();
    clone.setAttribute("viewBox", this._tightViewBox());
    const svgStr  = new XMLSerializer().serializeToString(clone);
    const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);

    const gallery = getGalleryData();
    gallery.push({
      id:           foundry.utils.randomID(),
      name:         trimmed,
      dataUrl,       // SVG data URL used as <img src=…> in gallery thumbnails
      contentHtml,   // raw drawing-layer HTML for lossless reload
      eraseMaskHtml, // raw erase-mask HTML so erased areas are preserved on reload
      createdAt:    Date.now(),
    });
    await setGalleryData(gallery);
    ui.notifications.info(game.i18n.localize("FIMBLEWOOD.Draw.Gallery.Saved"));
    if (_galleryInstance?.rendered) _galleryInstance.render();
  }

  /**
   * Load a gallery entry back into the draw pad.
   *
   * @param {string}  dataUrl       - SVG or PNG data URL (thumbnail; PNG fallback)
   * @param {string}  [contentHtml] - SVG drawing-layer HTML (modern entries)
   * @param {string}  [eraseMaskHtml] - SVG erase-mask HTML (entries saved with v1.6.14+)
   */
  _loadFromDataUrl(dataUrl, contentHtml, eraseMaskHtml) {
    return new Promise((resolve) => {
      // Abort any in-progress stroke
      this._activePaths = [];
      this._pathDataArr = [];

      if (contentHtml !== undefined && contentHtml !== null) {
        // Modern SVG entry: restore content directly — lossless, instant.
        this._contentGroup.innerHTML = contentHtml;
        // Restore erase mask; older entries without eraseMaskHtml start with a clean mask.
        if (this._erasePaths) this._erasePaths.innerHTML = eraseMaskHtml ?? "";
        this._finishLoad(resolve);
      } else {
        // Legacy PNG entry (pre-v1.6): embed as an SVG <image> element.
        const img = new Image();
        img.onload = () => {
          this._contentGroup.innerHTML = "";
          if (this._erasePaths) this._erasePaths.innerHTML = "";
          const scale   = Math.min(WORLD_SIZE / img.width, WORLD_SIZE / img.height);
          const dw      = Math.round(img.width  * scale);
          const dh      = Math.round(img.height * scale);
          const imageEl = this._svgEl("image", {
            x:      (WORLD_SIZE - dw) / 2,
            y:      (WORLD_SIZE - dh) / 2,
            width:  dw,
            height: dh,
            href:   dataUrl,
          });
          this._contentGroup.appendChild(imageEl);
          this._finishLoad(resolve);
        };
        img.onerror = () => this._finishLoad(resolve);
        img.src = dataUrl;
      }
    });
  }

  _finishLoad(resolve) {
    this._exitCircleMode();
    this._zoom      = 1.0;
    this._centerView();
    this._redoStack = [];
    this._history          = [];
    this._saveHistory();
    this._renderViewport();
    this._updateHistoryInfo();
    this._updateInkInfo();
    resolve();
  }
}

/* ──────────────────────────────────────────────
   Shared helper – name prompt dialog
   ────────────────────────────────────────────── */

function _promptName(title, defaultValue = "") {
  return new Promise((resolve) => {
    new Dialog({
      title,
      content: `<div style="margin-bottom:8px">
        <input type="text" id="fw-draw-gallery-name" value="${defaultValue}"
               style="width:100%;box-sizing:border-box">
      </div>`,
      buttons: {
        ok: {
          icon:     '<i class="fas fa-check"></i>',
          label:    game.i18n.localize("FIMBLEWOOD.Draw.Gallery.Confirm"),
          callback: (html) => resolve(html.find("#fw-draw-gallery-name").val()),
        },
        cancel: {
          icon:     '<i class="fas fa-times"></i>',
          label:    game.i18n.localize("Cancel"),
          callback: () => resolve(null),
        },
      },
      default: "ok",
      render:  (html) => {
        const inp = html.find("#fw-draw-gallery-name")[0];
        if (inp) { inp.focus(); inp.select(); }
      },
    }).render(true);
  });
}

/* ──────────────────────────────────────────────
   Gallery Application
   ────────────────────────────────────────────── */

class DrawGalleryApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id:          "fimblewood-draw-gallery",
      title:       game.i18n.localize("FIMBLEWOOD.Draw.GalleryTitle"),
      template:    null,
      classes:     ["fimblewood-draw-gallery"],
      width:       580,
      height:      480,
      resizable:   true,
      minimizable: true,
    });
  }

  async _renderInner() {
    const i18n    = (k) => game.i18n.localize(`FIMBLEWOOD.Draw.${k}`);
    const gallery = getGalleryData();
    const folders = getFolderData();

    // ── Card HTML builder ──
    const cardHtml = (entry) => {
      const gmBtn = game.user.isGM
        ? `<button class="fw-draw-gallery-btn fw-draw-gallery-show" data-id="${entry.id}"
                   title="${i18n("Gallery.Show")}"><i class="fas fa-eye"></i></button>`
        : "";
      const moveBtn = folders.length > 0
        ? `<button class="fw-draw-gallery-btn fw-draw-gallery-move" data-id="${entry.id}"
                   title="${i18n("Gallery.Move")}"><i class="fas fa-folder"></i></button>`
        : "";
      return `
        <div class="fw-draw-gallery-item" data-id="${entry.id}"
             data-folder-id="${entry.folderId ?? ""}" draggable="true">
          <img class="fw-draw-gallery-thumb" src="${entry.dataUrl}"
               alt="${entry.name}" draggable="false">
          <div class="fw-draw-gallery-name">
            <i class="fas fa-grip-vertical fw-draw-drag-handle"
               title="${i18n("Gallery.DragToReorder")}"></i>
            <span>${entry.name}</span>
          </div>
          <div class="fw-draw-gallery-actions">
            <button class="fw-draw-gallery-btn fw-draw-gallery-edit" data-id="${entry.id}"
                    title="${i18n("Gallery.Edit")}"><i class="fas fa-pencil-alt"></i></button>
            <button class="fw-draw-gallery-btn fw-draw-gallery-rename" data-id="${entry.id}"
                    title="${i18n("Gallery.Rename")}"><i class="fas fa-i-cursor"></i></button>
            ${moveBtn}${gmBtn}
            <button class="fw-draw-gallery-btn fw-draw-gallery-delete" data-id="${entry.id}"
                    title="${i18n("Gallery.Delete")}"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
    };

    // ── Toolbar ──
    let html = `<div class="fw-draw-gallery-toolbar">
      <button class="fw-draw-new-folder">
        <i class="fas fa-folder-plus"></i> ${i18n("Gallery.NewFolder")}
      </button>
    </div>`;

    // ── Named folder sections ──
    for (const folder of folders) {
      const entries   = gallery.filter(e => e.folderId === folder.id);
      const collapsed = !!folder.collapsed;
      html += `
        <div class="fw-draw-folder${collapsed ? " fw-draw-collapsed" : ""}"
             data-folder-id="${folder.id}">
          <div class="fw-draw-folder-header" data-folder-id="${folder.id}" draggable="true">
            <i class="fas fa-grip-vertical fw-draw-drag-handle"></i>
            <i class="fas fa-chevron-${collapsed ? "right" : "down"} fw-draw-folder-chevron"></i>
            <i class="fas fa-folder${collapsed ? "" : "-open"} fw-draw-folder-icon"></i>
            <span class="fw-draw-folder-label">${folder.name}</span>
            <div class="fw-draw-folder-btns">
              <button class="fw-draw-folder-btn fw-draw-folder-rename"
                      data-folder-id="${folder.id}"
                      title="${i18n("Gallery.FolderRename")}">
                <i class="fas fa-i-cursor"></i></button>
              <button class="fw-draw-folder-btn fw-draw-folder-delete"
                      data-folder-id="${folder.id}"
                      title="${i18n("Gallery.FolderDelete")}">
                <i class="fas fa-trash"></i></button>
            </div>
          </div>
          <div class="fw-draw-folder-items">
            ${entries.length
              ? entries.map(cardHtml).join("")
              : `<p class="fw-draw-folder-empty">${i18n("Gallery.FolderEmpty")}</p>`}
          </div>
        </div>`;
    }

    // ── Uncategorized / flat section ──
    const validIds = new Set(folders.map(f => f.id));
    const uncat    = gallery.filter(e => !e.folderId || !validIds.has(e.folderId));

    if (folders.length === 0) {
      // No folders yet — same flat grid as before
      if (gallery.length === 0) {
        html += `<p class="fw-draw-gallery-empty">${i18n("Gallery.Empty")}</p>`;
      } else {
        html += `<div class="fw-draw-gallery-grid">${gallery.map(cardHtml).join("")}</div>`;
      }
    } else {
      // Has folders — show uncategorized section (always present as a drop target)
      html += `
        <div class="fw-draw-folder fw-draw-uncategorized" data-folder-id="">
          <div class="fw-draw-folder-header fw-draw-uncategorized-header" data-folder-id="">
            <i class="fas fa-chevron-down fw-draw-folder-chevron"></i>
            <i class="fas fa-inbox"></i>
            <span class="fw-draw-folder-label">${i18n("Gallery.Uncategorized")}</span>
          </div>
          <div class="fw-draw-folder-items">
            ${uncat.length
              ? uncat.map(cardHtml).join("")
              : `<p class="fw-draw-folder-empty">${i18n("Gallery.FolderEmpty")}</p>`}
          </div>
        </div>`;
    }

    return $(`<div class="fw-draw-gallery-root">${html}</div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    // Entry actions
    html.find(".fw-draw-gallery-edit").on("click",   (e) => this._editEntry(e.currentTarget.dataset.id));
    html.find(".fw-draw-gallery-rename").on("click", (e) => this._renameEntry(e.currentTarget.dataset.id));
    html.find(".fw-draw-gallery-show").on("click",   (e) => this._showEntry(e.currentTarget.dataset.id));
    html.find(".fw-draw-gallery-delete").on("click", (e) => this._deleteEntry(e.currentTarget.dataset.id));
    html.find(".fw-draw-gallery-move").on("click",   (e) => this._moveEntry(e.currentTarget.dataset.id));
    // Folder actions
    html.find(".fw-draw-new-folder").on("click", () => this._createFolder());
    html.find(".fw-draw-folder-rename").on("click", (e) => {
      e.stopPropagation();
      this._renameFolder(e.currentTarget.dataset.folderId);
    });
    html.find(".fw-draw-folder-delete").on("click", (e) => {
      e.stopPropagation();
      this._deleteFolder(e.currentTarget.dataset.folderId);
    });
    html.find(".fw-draw-folder-header").on("click", (e) => {
      if (!e.target.closest("button")) this._toggleFolder(e.currentTarget.dataset.folderId);
    });
    this._bindDragSort(html);
  }

  _bindDragSort(html) {
    let dragId   = null;
    let dragType = null;  // "entry" | "folder"

    const clearHL = () =>
      html.find(".fw-draw-drag-over").each((_, el) => el.classList.remove("fw-draw-drag-over"));

    // ── Entry cards ──
    html.find(".fw-draw-gallery-item").each((_, el) => {
      el.addEventListener("dragstart", (e) => {
        dragId   = el.dataset.id;
        dragType = "entry";
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `entry:${dragId}`);
        e.stopPropagation();
        setTimeout(() => el.classList.add("fw-draw-dragging"), 0);
      });
      el.addEventListener("dragend", () => {
        el.classList.remove("fw-draw-dragging");
        clearHL();
        dragId = dragType = null;
      });
      el.addEventListener("dragover", (e) => {
        if (dragType !== "entry") return;
        e.preventDefault(); e.stopPropagation();
        if (el.dataset.id !== dragId) { clearHL(); el.classList.add("fw-draw-drag-over"); }
      });
      el.addEventListener("dragleave", (e) => {
        if (!el.contains(e.relatedTarget)) el.classList.remove("fw-draw-drag-over");
      });
      el.addEventListener("drop", async (e) => {
        if (dragType !== "entry") return;
        e.preventDefault(); e.stopPropagation();
        el.classList.remove("fw-draw-drag-over");
        const toId = el.dataset.id;
        if (!dragId || dragId === toId) return;
        const gallery = getGalleryData();
        const fromIdx = gallery.findIndex(g => g.id === dragId);
        const toIdx   = gallery.findIndex(g => g.id === toId);
        if (fromIdx < 0 || toIdx < 0) return;
        // Adopt the target's folder, then reorder
        gallery[fromIdx].folderId = gallery[toIdx].folderId ?? null;
        const [item] = gallery.splice(fromIdx, 1);
        gallery.splice(gallery.findIndex(g => g.id === toId), 0, item);
        await setGalleryData(gallery);
        this.render();
      });
    });

    // ── Folder headers — accept entry drops AND folder reorder drops ──
    html.find(".fw-draw-folder-header").each((_, el) => {
      el.addEventListener("dragover", (e) => {
        const isFolderDrop = dragType === "folder"
          && el.dataset.folderId !== dragId
          && !el.classList.contains("fw-draw-uncategorized-header");
        if (dragType !== "entry" && !isFolderDrop) return;
        e.preventDefault(); e.stopPropagation();
        clearHL(); el.classList.add("fw-draw-drag-over");
      });
      el.addEventListener("dragleave", (e) => {
        if (!el.contains(e.relatedTarget)) el.classList.remove("fw-draw-drag-over");
      });
      el.addEventListener("drop", async (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.remove("fw-draw-drag-over");
        if (!dragId) return;

        if (dragType === "entry") {
          // Move entry into this folder (or uncategorized)
          const targetFolderId = el.dataset.folderId || null;
          const gallery        = getGalleryData();
          const idx            = gallery.findIndex(g => g.id === dragId);
          if (idx < 0) return;
          gallery[idx].folderId = targetFolderId;
          await setGalleryData(gallery);
          this.render();
        } else if (dragType === "folder") {
          // Reorder folders
          const toFolderId = el.dataset.folderId;
          if (!toFolderId || toFolderId === dragId) return;
          const folders = getFolderData();
          const fromIdx = folders.findIndex(f => f.id === dragId);
          const toIdx   = folders.findIndex(f => f.id === toFolderId);
          if (fromIdx < 0 || toIdx < 0) return;
          const [folder] = folders.splice(fromIdx, 1);
          folders.splice(toIdx, 0, folder);
          await setFolderData(folders);
          this.render();
        }
      });
    });

    // ── Folder headers are draggable (folder reorder) ──
    html.find(".fw-draw-folder-header:not(.fw-draw-uncategorized-header)").each((_, el) => {
      el.addEventListener("dragstart", (e) => {
        dragId   = el.dataset.folderId;
        dragType = "folder";
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `folder:${dragId}`);
        setTimeout(() => el.closest(".fw-draw-folder")?.classList.add("fw-draw-dragging"), 0);
      });
      el.addEventListener("dragend", () => {
        el.closest(".fw-draw-folder")?.classList.remove("fw-draw-dragging");
        clearHL();
        dragId = dragType = null;
      });
    });
  }

  // ── Folder management ──

  async _createFolder() {
    const i18n = (k) => game.i18n.localize(`FIMBLEWOOD.Draw.${k}`);
    const name = await _promptName(i18n("Gallery.FolderNameTitle"), "");
    if (!name?.trim()) return;
    const folders = getFolderData();
    folders.push({ id: `f${Date.now()}`, name: name.trim(), collapsed: false });
    await setFolderData(folders);
    this.render();
  }

  async _renameFolder(id) {
    const folders = getFolderData();
    const idx     = folders.findIndex(f => f.id === id);
    if (idx < 0) return;
    const newName = await _promptName(
      game.i18n.localize("FIMBLEWOOD.Draw.Gallery.FolderRenameTitle"), folders[idx].name
    );
    if (!newName?.trim()) return;
    folders[idx].name = newName.trim();
    await setFolderData(folders);
    this.render();
  }

  async _deleteFolder(id) {
    // Move folder's entries back to root before removing the folder
    const gallery = getGalleryData();
    const folders = getFolderData();
    for (const entry of gallery) {
      if (entry.folderId === id) entry.folderId = null;
    }
    await setGalleryData(gallery);
    await setFolderData(folders.filter(f => f.id !== id));
    this.render();
  }

  async _toggleFolder(id) {
    // DOM-instant toggle so there's no re-render flicker
    const selector = id ? `.fw-draw-folder[data-folder-id="${id}"]`
                        : `.fw-draw-folder[data-folder-id=""]`;
    const folderEl = document.querySelector(selector);
    if (!folderEl) return;
    const collapsed = !folderEl.classList.contains("fw-draw-collapsed");
    folderEl.classList.toggle("fw-draw-collapsed", collapsed);
    const chevron = folderEl.querySelector(".fw-draw-folder-chevron");
    if (chevron) {
      chevron.classList.toggle("fa-chevron-down",  !collapsed);
      chevron.classList.toggle("fa-chevron-right",  collapsed);
    }
    const icon = folderEl.querySelector(".fw-draw-folder-icon");
    if (icon) {
      icon.classList.toggle("fa-folder-open", !collapsed);
      icon.classList.toggle("fa-folder",       collapsed);
    }
    // Persist for named folders only
    if (!id) return;
    const folders = getFolderData();
    const folder  = folders.find(f => f.id === id);
    if (folder) {
      folder.collapsed = collapsed;
      await setFolderData(folders);
    }
  }

  async _moveEntry(id) {
    const i18n    = (k) => game.i18n.localize(`FIMBLEWOOD.Draw.${k}`);
    const folders = getFolderData();
    const gallery = getGalleryData();
    const entry   = gallery.find(e => e.id === id);
    if (!entry) return;
    const current = entry.folderId ?? "";
    const options = [
      `<option value="" ${!current ? "selected" : ""}>${i18n("Gallery.Uncategorized")}</option>`,
      ...folders.map(f =>
        `<option value="${f.id}" ${f.id === current ? "selected" : ""}>${f.name}</option>`),
    ].join("");

    const chosen = await new Promise(resolve => {
      new Dialog({
        title:   i18n("Gallery.MoveTitle"),
        content: `<div style="padding:8px 4px">
                    <p style="margin:0 0 6px;color:#c8a060">${i18n("Gallery.MoveLabel")}</p>
                    <select id="fw-draw-move-select" style="width:100%">${options}</select>
                  </div>`,
        buttons: {
          ok:     { label: i18n("Gallery.Confirm"),
                    callback: (dlg) => resolve(dlg.find("#fw-draw-move-select").val() ?? null) },
          cancel: { label: "Cancel", callback: () => resolve(null) },
        },
        default: "ok",
      }).render(true);
    });

    if (chosen === null) return;
    const idx = gallery.findIndex(e => e.id === id);
    if (idx < 0) return;
    gallery[idx].folderId = chosen || null;
    await setGalleryData(gallery);
    this.render();
  }

  _editEntry(id) {
    const gallery = getGalleryData();
    const entry   = gallery.find(e => e.id === id);
    if (!entry) return;
    openDrawApp();
    const tryLoad = (n) => {
      const app = _appInstance;
      if (app?._svg && app?._contentGroup) {
        // Pass contentHtml + eraseMaskHtml for SVG entries; undefined for legacy PNG.
        app._loadFromDataUrl(entry.dataUrl, entry.contentHtml, entry.eraseMaskHtml);
      } else if (n < 40) {
        setTimeout(() => tryLoad(n + 1), 100);
      }
    };
    tryLoad(0);
  }

  async _renameEntry(id) {
    const gallery = getGalleryData();
    const idx     = gallery.findIndex(e => e.id === id);
    if (idx < 0) return;
    const newName = await _promptName(
      game.i18n.localize("FIMBLEWOOD.Draw.Gallery.RenameTitle"),
      gallery[idx].name
    );
    if (!newName?.trim()) return;
    gallery[idx].name = newName.trim();
    await setGalleryData(gallery);
    this.render();
  }

  _showEntry(id) {
    if (!game.user.isGM) return;
    const gallery = getGalleryData();
    const entry   = gallery.find(e => e.id === id);
    if (!entry) return;
    // SVG data URLs display correctly in ImagePopout's <img> element.
    new ImagePopout(entry.dataUrl, { window: { title: entry.name }, shareable: false }).render(true);
    game.socket.emit(`module.${MODULE_ID}`, { type: "showImage", src: entry.dataUrl, title: entry.name });
  }

  async _deleteEntry(id) {
    const gallery  = getGalleryData();
    const filtered = gallery.filter(e => e.id !== id);
    await setGalleryData(filtered);
    this.render();
  }
}

/* ──────────────────────────────────────────────
   Live-draw viewer (player-side)
   ────────────────────────────────────────────── */

class DrawLiveViewerApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id:          "fimblewood-draw-live-viewer",
      title:       game.i18n.localize("FIMBLEWOOD.Draw.LiveViewerTitle"),
      template:    null,
      classes:     ["fimblewood-draw-live-viewer"],
      width:       500,
      height:      520,
      resizable:   true,
      minimizable: true,
    });
  }

  async _renderInner() {
    const W = 2000;
    return $(`
      <div class="fw-draw-live-wrap">
        <div class="fw-draw-live-badge">
          <i class="fas fa-broadcast-tower"></i>
          <span id="fw-draw-live-gm-name"></span>
        </div>
        <svg id="fw-draw-live-svg" xmlns="http://www.w3.org/2000/svg"
             viewBox="0 0 ${W} ${W}">
          <defs>
            <radialGradient id="fw-draw-live-vignette" gradientUnits="userSpaceOnUse"
                            cx="${W/2}" cy="${W/2}" r="${W * 0.6}">
              <stop offset="0%"   stop-color="transparent"/>
              <stop offset="100%" stop-color="rgba(20,12,5,0.55)"/>
            </radialGradient>
            <filter id="fw-draw-live-grain" x="0%" y="0%" width="100%" height="100%"
                    color-interpolation-filters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.035 0.015"
                            numOctaves="4" stitchTiles="stitch" result="noise"/>
              <feComponentTransfer in="noise" result="grain">
                <feFuncR type="linear" slope="0.15" intercept="0.85"/>
                <feFuncG type="linear" slope="0.12" intercept="0.88"/>
                <feFuncB type="linear" slope="0.06" intercept="0.94"/>
              </feComponentTransfer>
              <feBlend in="SourceGraphic" in2="grain" mode="multiply"/>
            </filter>
            <mask id="fw-draw-live-mask">
              <rect width="${W}" height="${W}" fill="white"/>
              <g id="fw-draw-live-erase-paths"></g>
            </mask>
          </defs>
          <rect width="${W}" height="${W}" fill="#e8d5a3" filter="url(#fw-draw-live-grain)"/>
          <rect width="${W}" height="${W}" fill="url(#fw-draw-live-vignette)" pointer-events="none"/>
          <g id="fw-draw-live-content" pointer-events="none" mask="url(#fw-draw-live-mask)"></g>
        </svg>
      </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._liveSvg     = html.find("#fw-draw-live-svg")[0];
    this._liveContent = html.find("#fw-draw-live-content")[0];
    this._liveErase   = html.find("#fw-draw-live-erase-paths")[0];
    this._liveGmName  = html.find("#fw-draw-live-gm-name")[0];
  }

  update(contentHtml, eraseMaskHtml, viewBox, gmName) {
    if (this._liveContent) this._liveContent.innerHTML = contentHtml;
    if (this._liveErase)   this._liveErase.innerHTML   = eraseMaskHtml;
    if (this._liveSvg)     this._liveSvg.setAttribute("viewBox", viewBox);
    if (this._liveGmName && gmName) this._liveGmName.textContent = gmName;
  }
}

/* ──────────────────────────────────────────────
   Singleton + scene control buttons
   ────────────────────────────────────────────── */

let _appInstance      = null;
let _galleryInstance  = null;
let _liveViewerInst   = null;

function _openLiveViewer(gmName) {
  if (!_liveViewerInst || !_liveViewerInst.rendered) {
    _liveViewerInst = new DrawLiveViewerApp();
    _liveViewerInst.render(true);
  } else {
    if (_liveViewerInst._minimized) _liveViewerInst.maximize();
    _liveViewerInst.bringToTop();
  }
  // Set GM name on badge once open (may need a tick for DOM)
  if (gmName) setTimeout(() => {
    const el = document.getElementById("fw-draw-live-gm-name");
    if (el) el.textContent = gmName;
  }, 80);
}

export function openDrawApp() {
  if (!_appInstance || !_appInstance.rendered) {
    _appInstance = new DrawPadApp();
    _appInstance.render(true);
  } else {
    if (_appInstance._minimized) _appInstance.maximize();
    _appInstance.bringToTop();
  }
}

export function openGallery() {
  if (!_galleryInstance || !_galleryInstance.rendered) {
    _galleryInstance = new DrawGalleryApp();
    _galleryInstance.render(true);
  } else {
    if (_galleryInstance._minimized) _galleryInstance.maximize();
    _galleryInstance.bringToTop();
  }
}

/* ──────────────────────────────────────────────
   Registration
   ────────────────────────────────────────────── */

export function registerDrawPad() {
  // Socket – show a static image, or relay live-draw broadcast frames, to all players.
  Hooks.once("ready", () => {
    game.socket.on(`module.${MODULE_ID}`, (data) => {
      if (data.type === "showImage") {
        new ImagePopout(data.src, {
          window:    { title: data.title ?? game.i18n.localize("FIMBLEWOOD.Draw.WindowTitle") },
          shareable: false,
        }).render(true);

      } else if (data.type === "liveDrawingStart") {
        // Only open viewer for non-GM players
        if (!game.user.isGM) _openLiveViewer(data.gmName);

      } else if (data.type === "liveDrawing") {
        if (!game.user.isGM) {
          if (!_liveViewerInst?.rendered) _openLiveViewer(data.gmName);
          // Update happens once the app is rendered; small delay to let DOM settle
          const doUpdate = () => {
            if (_liveViewerInst?._liveContent) {
              _liveViewerInst.update(
                data.contentHtml, data.eraseMaskHtml, data.viewBox, data.gmName
              );
            } else {
              setTimeout(doUpdate, 50);
            }
          };
          doUpdate();
        }

      } else if (data.type === "liveDrawingStop") {
        if (!game.user.isGM) {
          _liveViewerInst?.close();
          _liveViewerInst = null;
        }
      }
    });
  });

  // A dedicated top-level scene-control category (a peer of Token Controls, not
  // a tool bolted onto an existing one) holding the draw pad and its gallery.
  Hooks.on("getSceneControlButtons", (controls) => {
    controls[CONTROL_GROUP] = {
      name:       CONTROL_GROUP,
      title:      "FIMBLEWOOD.ControlGroupTitle",
      icon:       "fas fa-house fimblewood-controls-icon",
      order:      Object.keys(controls).length,
      visible:    true,
      // Foundry requires activeTool to name a real tool, and immediately fires
      // that tool's onChange the moment this category itself is selected — not
      // just when one of its buttons is clicked. Both real tools here are
      // one-shot actions (open the draw pad / open the gallery), so neither can
      // be the default: pointing activeTool at either would pop its window open
      // as soon as the category is clicked. This invisible, no-op placeholder
      // tool satisfies the requirement without opening anything.
      activeTool: "none",
      tools: {
        // Not related to the draw pad's own internal "select" tool below — this is
        // purely a placeholder to satisfy activeTool, so the name is kept distinct.
        none: {
          name:     "none",
          title:    "FIMBLEWOOD.ControlGroupTitle",
          icon:     "fas fa-house",
          visible:  false,
          onChange: () => {},
        },
        drawpad: {
          name:     "drawpad",
          title:    "FIMBLEWOOD.Draw.ButtonTitle",
          icon:     "fas fa-magic",
          button:   true,
          visible:  true,
          order:    0,
          onChange: () => openDrawApp(),
        },
        gallery: {
          name:     "gallery",
          title:    "FIMBLEWOOD.Draw.GalleryTitle",
          icon:     "fas fa-images",
          button:   true,
          visible:  true,
          order:    1,
          onChange: () => openGallery(),
        },
      },
    };
  });
}

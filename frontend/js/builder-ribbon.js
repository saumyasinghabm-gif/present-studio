(() => {
  "use strict";

  const ribbon = document.querySelector(".ribbon");
  if (!ribbon) return;

  const tool = (action, icon, label, classes = "", attrs = "") => `
    <button class="tool-button ${classes}" type="button" data-builder-action="${action}" ${attrs} title="${label}">
      <i class="bi ${icon}"></i><span>${label}</span>
    </button>`;
  const iconTool = (action, icon, label, id = "") => `
    <button class="tool-button tool-small" ${id ? `id="${id}"` : ""} type="button" data-builder-action="${action}" aria-label="${label}" title="${label}"><i class="bi ${icon}"></i></button>`;
  const tall = (action, icon, label, classes = "", attrs = "") => tool(action, icon, label, `tool-tall ${classes}`, attrs);
  const group = (label, content, classes = "") => `<div class="ribbon-group ${classes}">${content}<span class="ribbon-group-label">${label}</span></div>`;
  const panel = (name, content, active = false) => `<div class="ribbon-panel ${active ? "is-active" : ""}" data-ribbon-panel="${name}" ${active ? "" : "hidden"}>${content}</div>`;

  const home = [
    group("Clipboard", `${tall("paste", "bi-clipboard-plus", "Paste", "", 'id="pasteObject"')}<div class="tool-stack">${tool("cut", "bi-scissors", "Cut")}${tool("copy", "bi-copy", "Copy", "", 'id="copyObject"')}${tool("format-painter", "bi-paint-bucket", "Format Painter")}</div>`),
    group("Slides", `${tall("new-slide", "bi-plus-square", "New Slide", "", 'id="addSlide"')}<div class="tool-stack">${tool("layout", "bi-layout-text-window", "Layout")}${tool("duplicate-slide", "bi-copy", "Duplicate")}${tool("delete-slide", "bi-trash", "Delete Slide")}</div>`),
    group("Font", `<div class="tool-stack"><div class="tool-row"><select class="ribbon-select font-select" id="fontFamily" aria-label="Font family"><option value="Arial">Arial</option><option value="Inter">Inter</option><option value="Georgia">Georgia</option><option value="Courier New">Courier New</option><option value="Verdana">Verdana</option></select><input class="ribbon-input size-select" id="fontSize" type="number" min="8" max="240" value="42" aria-label="Font size"></div><div class="tool-row">${iconTool("bold", "bi-type-bold", "Bold", "boldButton")}${iconTool("italic", "bi-type-italic", "Italic", "italicButton")}${iconTool("underline", "bi-type-underline", "Underline")}${iconTool("strike", "bi-type-strikethrough", "Strikethrough")}<input class="builder-color-input" id="textColor" type="color" value="#171717" aria-label="Text color"><button class="tool-button tool-small" type="button" data-builder-action="highlight" aria-label="Highlight color"><i class="bi bi-highlighter"></i></button></div></div><span id="selectionNote" hidden>Text</span>`),
    group("Paragraph", `<div class="tool-stack"><div class="tool-row">${iconTool("align-left", "bi-text-left", "Align left")}${iconTool("align-center", "bi-text-center", "Align center")}${iconTool("align-right", "bi-text-right", "Align right")}${iconTool("justify", "bi-justify", "Justify")}</div><div class="tool-row">${iconTool("bullets", "bi-list-ul", "Bullets")}${iconTool("numbering", "bi-list-ol", "Numbering")}${iconTool("indent-less", "bi-text-indent-right", "Decrease indent")}${iconTool("indent-more", "bi-text-indent-left", "Increase indent")}${iconTool("line-spacing", "bi-text-paragraph", "Line spacing")}</div></div>`),
    group("Arrange", `<div class="builder-arrange-grid">${tool("bring-forward", "bi-layer-forward", "Bring Forward", "", 'id="bringForward"')}${tool("send-backward", "bi-layer-backward", "Send Backward", "", 'id="sendBackward"')}${tool("align-objects", "bi-distribute-horizontal", "Align")}${tool("group", "bi-bounding-box", "Group / Ungroup")}${tool("rotate", "bi-arrow-clockwise", "Rotate")}${tool("duplicate-object", "bi-copy", "Duplicate", "", 'id="duplicateElement"')}${tool("delete-object", "bi-trash", "Delete", "", 'id="deleteElement"')}</div>`)
  ].join("");

  const insert = [
    group("Slides", tall("new-slide", "bi-plus-square", "New Slide")),
    group("Text", `${tall("insert-text", "bi-bounding-box-circles", "Text Box", "", 'id="insertText"')}${tall("word-art", "bi-type", "Word Art")}`),
    group("Media", `<label class="tool-button tool-tall file-ribbon-tool"><input type="file" accept="image/*" data-media-input="image"><i class="bi bi-image"></i><span>Image</span></label><label class="tool-button tool-tall file-ribbon-tool"><input type="file" accept="video/*" data-media-input="video"><i class="bi bi-play-btn"></i><span>Video</span></label><label class="tool-button tool-tall file-ribbon-tool"><input type="file" accept="audio/*,.mp3" data-media-input="audio"><i class="bi bi-volume-up"></i><span>Audio</span></label>`),
    group("Elements", `${tall("shapes", "bi-intersect", "Shapes")}${tall("icon", "bi-star", "Icons")}${tall("sticker", "bi-emoji-smile", "Stickers")}`),
    group("Data", `${tall("table", "bi-table", "Table")}${tall("chart", "bi-bar-chart", "Chart")}`),
    group("My Media", `<div class="media-library-grid" id="mediaLibraryGrid"></div><span id="mediaCount" class="builder-media-count">0 items</span>`, "builder-media-library")
  ].join("");

  const design = [
    group("Themes", `<button class="theme-card" type="button" data-builder-action="theme" data-theme="clean"><span class="theme-preview">Aa</span><span>Clean White</span></button><button class="theme-card" type="button" data-builder-action="theme" data-theme="yellow"><span class="theme-preview bold-yellow">Aa</span><span>Bold Yellow</span></button><button class="theme-card" type="button" data-builder-action="theme" data-theme="dark"><span class="theme-preview dark-contrast">Aa</span><span>Dark Contrast</span></button><button class="theme-card" type="button" data-builder-action="theme" data-theme="grid"><span class="theme-preview minimal-grid">Aa</span><span>Minimal Grid</span></button><button class="theme-card" type="button" data-builder-action="theme" data-theme="editorial"><span class="theme-preview editorial">Aa</span><span>Editorial</span></button>`),
    group("Variants", `<button class="variant-card" type="button" data-builder-action="variant" data-colors="#f5c842,#101010,#fffefb"><span class="variant-swatches" style="--sw1:#f5c842;--sw2:#101010;--sw3:#fffefb"><span></span><span></span><span></span></span></button><button class="variant-card" type="button" data-builder-action="variant" data-colors="#4263a8,#0f244b,#d5e0f6"><span class="variant-swatches" style="--sw1:#4263a8;--sw2:#0f244b;--sw3:#d5e0f6"><span></span><span></span><span></span></span></button><button class="variant-card" type="button" data-builder-action="variant" data-colors="#4a776d,#152b27,#d7e7e2"><span class="variant-swatches" style="--sw1:#4a776d;--sw2:#152b27;--sw3:#d7e7e2"><span></span><span></span><span></span></span></button>`),
    group("Customize", `<label class="tool-button tool-tall file-ribbon-tool"><input id="slideBackground" type="color" value="#ffffff"><i class="bi bi-window"></i><span>Background</span></label>`),
    group("Page Setup", tall("layout", "bi-layout-text-sidebar", "Layout"))
  ].join("");

  const transitions = [
    group("Preview", tall("preview-transition", "bi-play-circle", "Preview")),
    group("Transition to This Slide", [["none","bi-slash-circle","None"],["fade","bi-layers","Fade"],["slide","bi-box-arrow-right","Push"],["zoom","bi-intersect","Zoom"]].map(([value,icon,label]) => `<button class="preset-card" type="button" data-builder-action="transition" data-transition="${value}"><i class="bi ${icon}"></i><span>${label}</span></button>`).join("")),
    group("Timing", `<div class="tool-stack"><label class="compact-label"><span>Duration</span><select class="ribbon-select" id="transitionDuration"><option value="250">0.25 sec</option><option value="500" selected>0.5 sec</option><option value="900">0.9 sec</option></select></label>${tool("apply-transition-all", "bi-files", "Apply to All")}</div><select id="transitionType" hidden><option value="none">None</option><option value="fade">Fade</option><option value="slide">Slide</option><option value="zoom">Zoom</option></select>`)
  ].join("");

  const present = [
    group("Start Presentation", `${tall("present-beginning", "bi-play-circle", "From Beginning", "is-primary", 'id="startLive"')}${tall("present-current", "bi-display", "From Current Slide")}${tall("presenter-view", "bi-person-workspace", "Presenter View")}`),
    group("Choose Presenter", `<button class="presenter-option active" type="button" data-presenter="Self">Self</button><button class="presenter-option" type="button" data-presenter="Partner">Partner</button>`),
    group("Live Session", `${tall("toggle-live", "bi-broadcast", "Start Live")}${tall("audience-view", "bi-people", "Audience View", "", 'id="openAudience"')}`),
    group("Prepare", tall("speaker-notes", "bi-journal-text", "Speaker Notes"))
  ].join("");

  ribbon.innerHTML = panel("home", home, true) + panel("insert", insert) + panel("design", design) + panel("transitions", transitions) + panel("present", present);
  ribbon.querySelector('[data-ribbon-panel="home"] .ribbon-group:nth-child(3)').id = "editorPanel";
})();

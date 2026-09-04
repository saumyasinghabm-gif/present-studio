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
  const fontOptions = ["Arial", "Calibri", "Inter", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Garamond", "Palatino Linotype", "Courier New", "Impact"];

  const home = [
    group("Clipboard", `${tall("paste", "bi-clipboard-plus", "Paste", "", 'id="pasteObject"')}<div class="tool-stack">${tool("cut", "bi-scissors", "Cut")}${tool("copy", "bi-copy", "Copy", "", 'id="copyObject"')}${tool("format-painter", "bi-paint-bucket", "Format Painter")}</div>`),
    group("Text", `${tall("insert-text", "bi-bounding-box-circles", "Text Box", "", 'id="insertText"')}${tall("word-art", "bi-type", "Word Art")}`),
    group("Media", `<label class="tool-button tool-tall file-ribbon-tool"><input type="file" accept="image/*" data-media-input="image"><i class="bi bi-image"></i><span>Image</span></label><label class="tool-button tool-tall file-ribbon-tool"><input type="file" accept="video/*" data-media-input="video"><i class="bi bi-play-btn"></i><span>Video</span></label><label class="tool-button tool-tall file-ribbon-tool"><input type="file" accept="audio/*,.mp3" data-media-input="audio"><i class="bi bi-volume-up"></i><span>Audio</span></label><button class="tool-button" type="button" data-builder-action="fit-media"><i class="bi bi-arrows-fullscreen"></i><span>Fit Slide</span></button><small class="media-limit-note">Max 100 MB</small>`),
    group("My Media", `<div class="media-library-grid" id="mediaLibraryGrid"></div><span id="mediaCount" class="builder-media-count">0 items</span>`, "builder-media-library"),
    group("Font", `<div class="tool-stack"><div class="tool-row"><select class="ribbon-select font-select" id="fontFamily" aria-label="Font family">${fontOptions.map((font) => `<option value="${font}">${font === "Palatino Linotype" ? "Palatino" : font}</option>`).join("")}</select><input class="ribbon-input size-select" id="fontSize" type="number" min="8" max="240" value="42" aria-label="Font size"></div><div class="tool-row">${iconTool("bold", "bi-type-bold", "Bold", "boldButton")}${iconTool("italic", "bi-type-italic", "Italic", "italicButton")}${iconTool("underline", "bi-type-underline", "Underline")}${iconTool("strike", "bi-type-strikethrough", "Strikethrough")}<input class="builder-color-input" id="textColor" type="color" value="#171717" aria-label="Text color"><button class="tool-button tool-small" type="button" data-builder-action="highlight" aria-label="Highlight color"><i class="bi bi-highlighter"></i></button></div></div><span id="selectionNote" hidden>Text</span>`),
    group("Paragraph", `<div class="tool-stack"><div class="tool-row">${iconTool("align-left", "bi-text-left", "Align left")}${iconTool("align-center", "bi-text-center", "Align center")}${iconTool("align-right", "bi-text-right", "Align right")}${iconTool("justify", "bi-justify", "Justify")}</div><div class="tool-row">${iconTool("bullets", "bi-list-ul", "Bullets")}${iconTool("numbering", "bi-list-ol", "Numbering")}${iconTool("indent-less", "bi-text-indent-right", "Decrease indent")}${iconTool("indent-more", "bi-text-indent-left", "Increase indent")}${iconTool("line-spacing", "bi-text-paragraph", "Line spacing")}</div></div>`),
    group("Arrange", `<div class="builder-arrange-grid">${tool("bring-forward", "bi-layer-forward", "Bring Forward", "", 'id="bringForward"')}${tool("send-backward", "bi-layer-backward", "Send Backward", "", 'id="sendBackward"')}${tool("align-objects", "bi-distribute-horizontal", "Align")}${tool("group", "bi-bounding-box", "Group / Ungroup")}${tool("rotate", "bi-arrow-clockwise", "Rotate")}${tool("duplicate-object", "bi-copy", "Duplicate", "", 'id="duplicateElement"')}${tool("delete-object", "bi-trash", "Delete", "", 'id="deleteElement"')}</div>`)
  ].join("");

  const transitionOptions = [
    ["none", "None"], ["fade", "Fade"], ["push-right", "Push"], ["morph", "Morph"], ["zoom", "Zoom"]
  ];

  const transitions = [
    group("Preview", tall("preview-transition", "bi-play-circle", "Preview")),
    group("Transition", `<button class="preset-card" type="button" data-builder-action="transition" data-transition="none"><i class="bi bi-slash-circle"></i><span>None</span></button><button class="preset-card" type="button" data-builder-action="transition" data-transition="fade"><i class="bi bi-layers"></i><span>Fade</span></button><button class="preset-card" type="button" data-builder-action="transition" data-transition="push-right"><i class="bi bi-box-arrow-right"></i><span>Push</span></button><button class="preset-card" type="button" data-builder-action="transition" data-transition="morph"><i class="bi bi-intersect"></i><span>Morph</span></button><button class="preset-card" type="button" data-builder-action="transition" data-transition="zoom"><i class="bi bi-zoom-in"></i><span>Zoom</span></button>`),
    group("Timing", `<div class="tool-stack"><label class="compact-label"><span>Preset</span><select class="ribbon-select" id="transitionDuration"><option value="250">0.25 sec</option><option value="500" selected>0.5 sec</option><option value="900">0.9 sec</option></select></label><label class="compact-label"><span>Custom ms</span><input class="ribbon-input duration-input" id="transitionDurationCustom" type="number" min="50" max="10000" step="50" value="500"></label>${tool("apply-transition-all", "bi-files", "Apply to All")}</div><select id="transitionType" hidden>${transitionOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>`)
  ].join("");

  const animations = [
    group("Preview", tall("preview-animation", "bi-play-circle", "Preview")),
    group("Entrance", `<button class="preset-card" type="button" data-builder-action="animation" data-animation="none"><i class="bi bi-slash-circle"></i><span>None</span></button><button class="preset-card" type="button" data-builder-action="animation" data-animation="fade"><i class="bi bi-stars"></i><span>Fade</span></button><button class="preset-card" type="button" data-builder-action="animation" data-animation="zoom"><i class="bi bi-zoom-in"></i><span>Zoom</span></button><button class="preset-card" type="button" data-builder-action="animation" data-animation="fly"><i class="bi bi-arrow-right"></i><span>Fly In</span></button><button class="preset-card" type="button" data-builder-action="animation" data-animation="rise"><i class="bi bi-arrow-up"></i><span>Rise</span></button><button class="preset-card" type="button" data-builder-action="animation" data-animation="wipe"><i class="bi bi-layout-sidebar-inset"></i><span>Wipe</span></button>`),
    group("Timing", `<label class="compact-label"><span>Duration</span><input class="ribbon-input duration-input" id="animationDuration" type="number" min="100" max="5000" step="50" value="600"></label><label class="compact-label"><span>Delay</span><input class="ribbon-input duration-input" id="animationDelay" type="number" min="0" max="5000" step="50" value="0"></label>`)
  ].join("");

  ribbon.innerHTML = panel("home", home, true) + panel("transitions", transitions) + panel("animations", animations);
  ribbon.querySelector('[data-ribbon-panel="home"] .ribbon-group:nth-child(5)').id = "editorPanel";
})();

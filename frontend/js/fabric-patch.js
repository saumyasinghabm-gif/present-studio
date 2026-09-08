// ============================================================================
// fabric-patch.js
// ----------------------------------------------------------------------------
// Patches a bug in fabric.js 5.3.0 where _setTextStyles sets
// ctx.textBaseline = 'alphabetical' (a misspelling). The valid enum value is
// 'alphabetic'. The browser ignores the invalid assignment but logs a console
// warning every time a text object is rendered.
//
// This file must be loaded AFTER fabric.js but BEFORE any page that creates
// a fabric.Canvas. It monkey-patches the prototype methods so the corrected
// value is used at render time, and normalises any loaded JSON that may have
// persisted the bad value (e.g. older presentation data that round-tripped
// through canvas.toJSON()).
// ============================================================================

(function patchFabricTextBaseline() {
  if (typeof window === "undefined" || !window.fabric) {
    return;
  }
  var fabricRef = window.fabric;
  var textBaselineDescriptor =
    window.CanvasRenderingContext2D &&
    Object.getOwnPropertyDescriptor(window.CanvasRenderingContext2D.prototype, "textBaseline");

  function setSafeTextBaseline(ctx, value) {
    var safeValue = value === "alphabetical" ? "alphabetic" : value;
    if (textBaselineDescriptor && textBaselineDescriptor.set) {
      textBaselineDescriptor.set.call(ctx, safeValue);
    } else {
      ctx.textBaseline = safeValue;
    }
  }

  function withTextBaselineGuard(ctx, callback) {
    if (!ctx || !textBaselineDescriptor || !textBaselineDescriptor.get || !textBaselineDescriptor.set) {
      return callback();
    }
    var guarded = false;
    try {
      Object.defineProperty(ctx, "textBaseline", {
        configurable: true,
        get: function getTextBaseline() {
          return textBaselineDescriptor.get.call(ctx);
        },
        set: function setTextBaseline(value) {
          setSafeTextBaseline(ctx, value);
        },
      });
      guarded = true;
    } catch (e) {
      return callback();
    }
    try {
      return callback();
    } finally {
      if (guarded) {
        try {
          delete ctx.textBaseline;
        } catch (e) {
          // Ignore cleanup failures; the guarded setter is still safe.
        }
      }
    }
  }

  // 1) Fix the rendering method that assigns the bad value to the 2D context.
  //    Walk the prototype chain because Text/IText/Textbox each have their own
  //    copy of _setTextStyles in some fabric builds.
  function fixSetTextStyles(proto) {
    if (!proto || !proto._setTextStyles) return;
    var original = proto._setTextStyles;
    // Avoid double-patching if this script is loaded twice.
    if (original.__patchedForAlphabetic) return;
    proto._setTextStyles = function patchedSetTextStyles(ctx, charStyle, forMeasuring) {
      return withTextBaselineGuard(ctx, function runOriginalTextStyles() {
        return original.call(this, ctx, charStyle, forMeasuring);
      }.bind(this));
    };
    proto._setTextStyles.__patchedForAlphabetic = true;
  }

  // Patch every Text-like class that exists on fabric.
  var textLikeClasses = ["Text", "IText", "Textbox"];
  for (var i = 0; i < textLikeClasses.length; i++) {
    var cls = fabricRef[textLikeClasses[i]];
    if (cls && cls.prototype) {
      fixSetTextStyles(cls.prototype);
    }
  }

  // 2) Normalise any value currently sitting on a text object. If older
  //    presentation data was round-tripped through canvas.toJSON() the
  //    'alphabetical' string may have ended up in the serialised scene. We
  //    scrub it on loadFromJSON and on the constructor default to prevent the
  //    warning from re-appearing.
  function normaliseTextBaseline(value) {
    return value === "alphabetical" ? "alphabetic" : value;
  }

  // 3) Patch the static default so any newly created text object starts
  //    with the correct value.
  function fixDefaults(proto) {
    if (!proto) return;
    if (Object.prototype.hasOwnProperty.call(proto, "textBaseline")) {
      if (proto.textBaseline === "alphabetical") {
        proto.textBaseline = "alphabetic";
      }
    }
  }
  for (var j = 0; j < textLikeClasses.length; j++) {
    var tcls = fabricRef[textLikeClasses[j]];
    if (tcls) fixDefaults(tcls);
  }

  // 4) Patch loadFromJSON on the Canvas prototype to scrub the bad value
  //    out of incoming JSON before any text object is constructed.
  function patchLoadFromJSON(proto) {
    if (!proto || !proto.loadFromJSON) return;
    var originalLoad = proto.loadFromJSON;
    if (originalLoad.__patchedForAlphabetic) return;
    proto.loadFromJSON = function patchedLoadFromJSON(json, callback) {
      try {
        var objects = json && json.objects;
        if (Array.isArray(objects)) {
          for (var k = 0; k < objects.length; k++) {
            var obj = objects[k];
            if (obj && obj.type && textLikeClasses.indexOf(obj.type) >= 0) {
              if (obj.textBaseline === "alphabetical") {
                obj.textBaseline = "alphabetic";
              }
            }
          }
        }
      } catch (e) {
        // If scrubbing fails, fall through to the original loader.
      }
      return originalLoad.call(this, json, callback);
    };
    proto.loadFromJSON.__patchedForAlphabetic = true;
  }

  if (fabricRef.Canvas && fabricRef.Canvas.prototype) {
    patchLoadFromJSON(fabricRef.Canvas.prototype);
  }
  if (fabricRef.StaticCanvas && fabricRef.StaticCanvas.prototype) {
    patchLoadFromJSON(fabricRef.StaticCanvas.prototype);
  }

  // Fabric 5 stores one textAlign value for an entire Textbox. PowerPoint-style
  // editing needs alignment to belong to a paragraph, while every visual line
  // created by wrapping must inherit its source paragraph's alignment.
  function alignmentForVisualLine(textbox, visualLineIndex) {
    if (!Array.isArray(textbox.paragraphAlignments)) return null;
    var styleMap = textbox._styleMap || textbox.__styleMap;
    var mapEntry = styleMap && styleMap[visualLineIndex];
    var paragraphIndex = mapEntry && Number.isFinite(mapEntry.line) ? mapEntry.line : visualLineIndex;
    var alignment = textbox.paragraphAlignments[paragraphIndex];
    return ["left", "center", "right", "justify"].indexOf(alignment) >= 0 ? alignment : null;
  }

  function withVisualLineAlignment(textbox, visualLineIndex, callback) {
    var alignment = alignmentForVisualLine(textbox, visualLineIndex);
    if (!alignment || alignment === textbox.textAlign) return callback();
    var originalAlignment = textbox.textAlign;
    textbox.textAlign = alignment;
    try {
      return callback();
    } finally {
      textbox.textAlign = originalAlignment;
    }
  }

  function patchParagraphAlignment(proto) {
    if (!proto) return;
    var originalOffset = proto._getLineLeftOffset;
    if (originalOffset && !originalOffset.__patchedForParagraphAlignment) {
      proto._getLineLeftOffset = function patchedLineLeftOffset(lineIndex) {
        return withVisualLineAlignment(this, lineIndex, function getOriginalOffset() {
          return originalOffset.call(this, lineIndex);
        }.bind(this));
      };
      proto._getLineLeftOffset.__patchedForParagraphAlignment = true;
    }

    var originalRenderLine = proto._renderTextLine;
    if (originalRenderLine && !originalRenderLine.__patchedForParagraphAlignment) {
      proto._renderTextLine = function patchedRenderTextLine(method, ctx, line, left, top, lineIndex) {
        var args = arguments;
        return withVisualLineAlignment(this, lineIndex, function renderOriginalLine() {
          return originalRenderLine.apply(this, args);
        }.bind(this));
      };
      proto._renderTextLine.__patchedForParagraphAlignment = true;
    }
  }

  if (fabricRef.Textbox && fabricRef.Textbox.prototype) {
    patchParagraphAlignment(fabricRef.Textbox.prototype);
  }
})();

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

  // 1) Fix the rendering method that assigns the bad value to the 2D context.
  //    Walk the prototype chain because Text/IText/Textbox each have their own
  //    copy of _setTextStyles in some fabric builds.
  function fixSetTextStyles(proto) {
    if (!proto || !proto._setTextStyles) return;
    var original = proto._setTextStyles;
    // Avoid double-patching if this script is loaded twice.
    if (original.__patchedForAlphabetic) return;
    proto._setTextStyles = function patchedSetTextStyles(ctx, charStyle, forMeasuring) {
      // Call the original first so it can do everything else it normally does,
      // then overwrite the bad value it just set on the context.
      var result = original.call(this, ctx, charStyle, forMeasuring);
      if (ctx && ctx.textBaseline === "alphabetical") {
        ctx.textBaseline = "alphabetic";
      }
      return result;
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
})();

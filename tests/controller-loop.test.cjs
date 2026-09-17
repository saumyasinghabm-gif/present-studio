const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const controllerSource = fs.readFileSync(path.join(__dirname, "../frontend/js/controller.js"), "utf8");
const loopStart = controllerSource.indexOf("  function selectedLoopTargets");
const loopEnd = controllerSource.indexOf("\n  bindControllerConsole", loopStart);
const loopSource = controllerSource.slice(loopStart, loopEnd);

function loopHarness(targets, interval = "12000") {
  const selected = [];
  const timers = [];
  const clearedTimers = [];
  const mediaActions = [];
  const status = { textContent: "" };
  let currentVideo = null;

  const context = {
    Event,
    targets,
    document: {
      querySelectorAll() {
        return targets.map(target => ({ value: target.id }));
      }
    },
    $(selector) {
      if (selector === "#loopInterval") return { value: interval };
      if (selector === "#loopStatus") return status;
      throw new Error(`Unexpected selector: ${selector}`);
    },
    selectTarget(target) {
      selected.push(target.id);
      currentVideo = target.kind === "video"
        ? Object.assign(new EventTarget(), { tagName: "VIDEO", loop: true })
        : null;
    },
    primaryPreviewMedia() {
      return currentVideo;
    },
    sendMediaControl(action) {
      mediaActions.push(action);
    },
    toast(message) {
      throw new Error(message);
    },
    setInterval(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearInterval(timer) {
      if (timer) clearedTimers.push(timer);
    }
  };

  vm.runInNewContext(`
    let loopTimer = null;
    let loopRunning = false;
    let loopGeneration = 0;
    let loopKind = "";
    ${loopSource}
    this.loopApi = {
      startLoop,
      stopLoop,
      state: () => ({ loopRunning, loopGeneration, loopKind })
    };
  `, context);

  return {
    ...context.loopApi,
    selected,
    timers,
    clearedTimers,
    mediaActions,
    status,
    currentVideo: () => currentVideo
  };
}

test("image loops retain the selected fixed interval", () => {
  const harness = loopHarness([
    { id: "image-1", kind: "image" },
    { id: "image-2", kind: "image" }
  ]);

  harness.startLoop("image", "#imageLoopList");
  assert.deepEqual(harness.selected, ["image-1"]);
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].delay, 12000);

  harness.timers[0].callback();
  assert.deepEqual(harness.selected, ["image-1", "image-2"]);
  harness.stopLoop();
  harness.timers[0].callback();
  assert.deepEqual(harness.selected, ["image-1", "image-2"]);
  assert.deepEqual(harness.mediaActions, []);
});

test("video loops advance on ended and Stop cancels playback and stale callbacks", () => {
  const harness = loopHarness([
    { id: "video-1", kind: "video" },
    { id: "video-2", kind: "video" }
  ]);

  harness.startLoop("video", "#videoLoopList");
  const firstVideo = harness.currentVideo();
  assert.deepEqual(harness.selected, ["video-1"]);
  assert.equal(firstVideo.loop, false);
  assert.equal(harness.timers.length, 0);

  firstVideo.dispatchEvent(new Event("ended"));
  const secondVideo = harness.currentVideo();
  assert.deepEqual(harness.selected, ["video-1", "video-2"]);
  assert.equal(secondVideo.loop, false);

  harness.stopLoop();
  secondVideo.dispatchEvent(new Event("ended"));
  assert.deepEqual(harness.selected, ["video-1", "video-2"]);
  assert.deepEqual(harness.mediaActions, ["stop"]);
  assert.equal(harness.state().loopRunning, false);
  assert.equal(harness.state().loopGeneration, 2);
  assert.equal(harness.state().loopKind, "");

  harness.startLoop("video", "#videoLoopList");
  harness.currentVideo().dispatchEvent(new Event("ended"));
  harness.stopLoop();
  assert.deepEqual(harness.selected, ["video-1", "video-2", "video-1", "video-2"]);
  assert.deepEqual(harness.mediaActions, ["stop", "stop"]);
});

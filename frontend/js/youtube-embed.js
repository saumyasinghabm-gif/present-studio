(() => {
  "use strict";

  const validId = /^[A-Za-z0-9_-]{11}$/;
  let apiPromise;

  function parse(input) {
    try {
      const url = new URL(String(input || "").trim());
      if (!/^https?:$/.test(url.protocol)) return "";
      const host = url.hostname.toLowerCase();
      let id = "";
      if (host === "youtu.be" || host === "www.youtu.be") {
        const parts = url.pathname.split("/").filter(Boolean);
        id = parts.length === 1 ? parts[0] : "";
      }
      else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com"].includes(host)) {
        const parts = url.pathname.split("/").filter(Boolean);
        id = parts.length === 1 && parts[0] === "watch" ? url.searchParams.get("v") : parts.length === 2 && ["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : "";
      }
      return validId.test(id || "") ? id : "";
    } catch { return ""; }
  }

  function idFor(item) {
    const id = String(item?.youtubeId || "");
    return validId.test(id) ? id : parse(item?.src);
  }

  function embedUrl(id, autoplay = true) {
    if (!validId.test(String(id))) return "";
    const url = new URL(`https://www.youtube.com/embed/${id}`);
    url.searchParams.set("autoplay", autoplay ? "1" : "0");
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("origin", location.origin);
    return url.href;
  }

  function frame(item, autoplay = true) {
    const id = idFor(item);
    if (!id) return null;
    const iframe = document.createElement("iframe");
    iframe.src = embedUrl(id, autoplay);
    iframe.dataset.youtubeId = id;
    iframe.title = "YouTube video";
    iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.setAttribute("loading", "eager");
    return iframe;
  }

  function loadApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.onerror = () => reject(new Error("YouTube controls unavailable"));
      document.head.append(script);
    });
    return apiPromise;
  }

  function applyPlayerState(iframe) {
    const player = iframe._youtubePlayer;
    const state = iframe._youtubeState;
    if (!player || !state || typeof player.setVolume !== "function") return;
    player.setVolume(Math.round(Math.max(0, Math.min(1, Number(state.volume) || 0)) * 100));
    if (state.muted) player.mute(); else player.unMute();
    if (Number.isFinite(Number(state.position)) && state.position !== undefined && typeof player.seekTo === "function") {
      const position = Math.max(0, Number(state.position));
      if (typeof player.getCurrentTime !== "function" || Math.abs(player.getCurrentTime() - position) > 1.5) player.seekTo(position, true);
      state.position = undefined;
    }
    if (state.playing === false) player.pauseVideo();
    else if (state.playing === true) { player.playVideo(); state.playing = undefined; }
  }

  function sync(iframe, state = {}) {
    if (!iframe?.dataset.youtubeId) return;
    iframe._youtubeState = { ...iframe._youtubeState, ...state };
    if (iframe._youtubePlayer) return applyPlayerState(iframe);
    if (iframe._youtubePending) return;
    iframe._youtubePending = true;
    loadApi().then(YT => {
      if (!iframe.isConnected) return;
      iframe._youtubePlayer = new YT.Player(iframe, { events: { onReady: () => applyPlayerState(iframe) } });
    }).catch(() => { /* The iframe still has its own play and volume controls. */ }).finally(() => { iframe._youtubePending = false; });
  }

  window.SnapKeyYouTube = { parse, idFor, embedUrl, frame, sync };
})();

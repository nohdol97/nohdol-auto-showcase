(function exposeShowcasePlatform(root) {
  function detectAssetId(platform = "", userAgent = "") {
    if (/android|iphone|ipad|ipod/i.test(userAgent)) return null;
    const normalized = platform.toLowerCase();
    if (normalized.includes("win")) return "windows";
    if (normalized.includes("mac")) return "macos";
    if (normalized.includes("linux") || normalized.includes("x11")) return "linux";
    return null;
  }

  root.showcasePlatform = Object.freeze({ detectAssetId });
})(window);

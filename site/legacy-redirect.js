(() => {
  const legacyOrigin = "https://nohdol97.github.io";
  const legacyBasePath = "/nohdol-auto-showcase";
  const primaryOrigin = "https://byabalone.com";
  const location = window.location;
  if (location.origin !== legacyOrigin) return;
  if (location.pathname !== legacyBasePath && !location.pathname.startsWith(`${legacyBasePath}/`)) return;

  const target = new URL(location.pathname.slice(legacyBasePath.length) || "/", primaryOrigin);
  target.search = location.search;
  target.hash = location.hash;
  location.replace(target.href);
})();

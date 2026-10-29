module.exports = function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const siteKey = process.env.TURNSTILE_SITE_KEY;
  if (!siteKey) {
    return res.status(503).json({ error: "Email sending is not configured yet." });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ turnstileSiteKey: siteKey });
};

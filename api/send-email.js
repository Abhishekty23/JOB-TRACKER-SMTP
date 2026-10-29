const nodemailer = require("nodemailer");
const { Ratelimit } = require("@upstash/ratelimit");
const { Redis } = require("@upstash/redis");

const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const MAX_JOBS = 50;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character];
  });
}

function validateJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > MAX_JOBS) {
    return null;
  }

  const validJobs = [];
  for (const job of jobs) {
    if (!job || typeof job.company !== "string" || typeof job.role !== "string" || typeof job.link !== "string") {
      return null;
    }

    const company = job.company.trim();
    const role = job.role.trim();
    if (!company || !role || company.length > 200 || role.length > 200) {
      return null;
    }

    let link;
    try {
      link = new URL(job.link);
    } catch (error) {
      return null;
    }
    if ((link.protocol !== "https:" && link.protocol !== "http:") || link.username || link.password) {
      return null;
    }

    validJobs.push({ company, role, link: link.href });
  }
  return validJobs;
}

async function verifyTurnstile(token, secret, ip, expectedHostname) {
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    throw new Error("Email verification service unavailable.");
  }

  const result = await response.json();
  return result.success === true && result.hostname === expectedHostname;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const appOrigin = process.env.APP_ORIGIN;
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (!appOrigin || !turnstileSecret || !process.env.SMTP_HOST || !process.env.SMTP_USER ||
      !process.env.SMTP_PASS || !process.env.SMTP_FROM || !process.env.UPSTASH_REDIS_REST_URL ||
      !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(503).json({ error: "Email sending is not fully configured yet." });
  }

  if (req.headers.origin !== appOrigin) {
    return res.status(403).json({ error: "Request origin is not allowed." });
  }
  res.setHeader("Access-Control-Allow-Origin", appOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      return res.status(400).json({ error: "Invalid request body." });
    }
  }
  const to = payload && typeof payload.to === "string" ? payload.to.trim() : "";
  const token = payload && typeof payload.turnstileToken === "string" ? payload.turnstileToken : "";
  const jobs = validateJobs(payload && payload.jobs);
  if (to.length > 254 || !EMAIL_PATTERN.test(to) || !token || !jobs) {
    return res.status(400).json({ error: "Enter a valid email address and shareable jobs." });
  }

  let hostname;
  try {
    hostname = new URL(appOrigin).hostname;
  } catch (error) {
    return res.status(503).json({ error: "Email sending configuration is invalid." });
  }

  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = (typeof forwardedFor === "string" ? forwardedFor.split(",")[0] : "").trim() ||
    req.headers["x-real-ip"] || "unknown";

  try {
    const limiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(5, "1 h"),
      prefix: "job-tracker-email"
    });
    const limit = await limiter.limit(ip);
    if (!limit.success) {
      return res.status(429).json({ error: "Email sending limit reached. Try again later." });
    }

    const verified = await verifyTurnstile(token, turnstileSecret, ip, hostname);
    if (!verified) {
      return res.status(400).json({ error: "Email verification failed. Please try again." });
    }

    const port = Number(process.env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(503).json({ error: "Email sending configuration is invalid." });
    }

    const textList = jobs.map(function (job, index) {
      return (index + 1) + ". " + job.company + " — " + job.role + "\n   Apply link: " + job.link;
    }).join("\n\n");
    const htmlList = jobs.map(function (job) {
      return "<li><strong>" + escapeHtml(job.company) + "</strong> — " + escapeHtml(job.role) +
        '<br><a href="' + escapeHtml(job.link) + '">Apply for this role</a></li>';
    }).join("");

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: "Job openings you can apply to",
      text: "Hi,\n\nHere are some jobs you can apply to:\n\n" + textList + "\n\nAll the best!",
      html: "<p>Hi,</p><p>Here are some jobs you can apply to:</p><ol>" + htmlList + "</ol><p>All the best!</p>"
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Job tracker email delivery failed.", error && error.code ? error.code : "service error");
    return res.status(502).json({ error: "Email could not be sent. Check the email service configuration and try again." });
  }
};

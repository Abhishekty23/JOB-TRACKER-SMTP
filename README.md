# Job Application Tracker

## Deploying email sending on Vercel

The page can send up to 50 shareable jobs through an SMTP account after the deployment is configured. The recipient is entered in the dialog and the user must click **Send email** and complete Cloudflare Turnstile verification. Only company, role, and apply link are sent; personal notes and application status are excluded. The endpoint limits each IP address to five send attempts per hour.

The share dialog also has **Download job list (CSV)**. It downloads only company name, role, and apply link in a spreadsheet-friendly CSV file.

1. Deploy this folder as a Vercel project using Node.js 20 or newer.
2. Create a Cloudflare Turnstile widget for the deployment hostname and an Upstash Redis database.
3. Add these environment variables in the Vercel project settings:

   - `APP_ORIGIN`: the exact deployment origin, such as `https://your-project.vercel.app` (no trailing slash)
   - `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: the Turnstile widget keys
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: the Upstash Redis REST credentials
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS`: the SMTP server configuration
   - `SMTP_FROM`: the authorized sender address for that SMTP account

4. Redeploy after setting the variables. Open the deployed site, add at least one job with an apply link, enter the recipient's email, complete verification, and click **Send email**.

Never put SMTP or Turnstile secret keys in the HTML or share them publicly. Opening `job-tracker.html` directly from disk does not provide the `/api` endpoints; run and deploy it through Vercel for actual email sending.

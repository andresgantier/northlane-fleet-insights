# From portfolio demo to production

NorthLane Fleet Insights runs on free tiers with fictional data and public demo accounts. This document lists what would change before a real fleet operator relies on it, ordered by priority. Prices are approximate: check the providers' current price lists.

## 1. Language model: paid tier and data privacy (must have)

| Topic | Demo today | Production |
|---|---|---|
| **Data use by the provider** | Gemini **free tier**: Google may use prompts and answers to improve its products. Acceptable only because the data is fictional. | **Paid tier** (or the same model through Google Cloud Vertex AI / another enterprise provider) under a data processing agreement: prompts and data are **not** used for training, EU data residency where offered. |
| **Model and quota** | `gemini-3.5-flash-lite`. On the free tier the newer Flash models were either overloaded (503) or limited to 20 requests per day; Flash-Lite has a low per-minute limit. | Paid quota sized for peak use; a stronger model for complex questions, and a **fallback model** when the main one is unavailable. |
| **What is sent to the model** | The question, the conversation, the tool results (aggregated numbers, vehicle IDs and plates). | The same: no personal data is needed. Keep it that way (no driver names), document it in the data protection impact assessment. |
| **Keys** | One API key in Vercel. Some values were shared during development. | Rotate every key and password before go-live; separate keys per environment; keys in a secret manager. |

## 2. Before go-live (must have)

| Topic | Demo today | Production |
|---|---|---|
| **Sign-in** | Neon Auth with e-mail and password; two demo accounts | **Single sign-on** with the company directory (e.g. Microsoft Entra ID), so access ends automatically when someone leaves; roles and depots synchronised from HR or the directory |
| **Demo access** | One-click demo buttons with a shared password | Remove the demo buttons, the demo accounts and `DEMO_PASSWORD` |
| **Data source** | Two Excel exports, dates shifted to today, imported by hand (`npm run db:import`) | Scheduled load from the fleet management system or data warehouse (every night instead of every two weeks), no date shift, with the same data-quality report sent to the data owner |
| **Hosting plans** | Neon Free, Vercel Hobby (non-commercial use only) | Neon paid plan (more compute, longer history and backups, point-in-time restore), Vercel Pro (commercial use) |
| **Data protection (GDPR)** | No personal data except demo accounts | Data processing agreements with Neon, Vercel and the model provider (EU regions already used); retention rule for the question log (e.g. 90 days); privacy notice for users |

## 3. Monitoring the assistant's quality

The evaluation set is the core of this: an assistant is only as trustworthy as its last measured score.

- **Evaluation on every change:** run `npm run eval` in CI for every change to instructions, tools, model or semantic layer; block the release if the score drops (e.g. below 95 %) or any trap question is answered.
- **Grow the set from real use:** every week, review a sample of logged questions and the ones users mark as wrong, and add them with SQL-computed answers.
- **Production metrics** from the question log (`assistant_questions`): answered vs. declined, errors, rate limits, latency, tools used. Alert on spikes in errors or declines.
- **User feedback:** a "thumbs down" on each answer, stored with the question for the weekly review.
- **Model updates:** pin the model version; switch only after the evaluation passes on the new version.

## 4. Security and supervised actions

- Opening an FRC stays **human-approved**; any new action follows the same pattern (database function with role check, idempotency and audit).
- Rate limits per user (with SSO there is a real user identity instead of a browser cookie).
- Security headers (Content Security Policy, strict transport security), dependency updates, protected `main` branch with reviews.
- The audit log (`frc_actions`) exported to the company's log system.

## 5. Operations

- Uptime monitor on `/api/health`; alert when the nightly import fails or its data-quality report shows new anomalies.
- Staging environment (Neon branch + Vercel preview) where migrations and the evaluation run first.
- Support model: business owner (Fleet Operations) for rules and access, technical owner for deployments, model changes and restores.

## 6. Approximate running cost

| Item | Monthly (approx.) |
|---|---|
| Neon paid plan | ~20–70 USD depending on compute |
| Vercel Pro | ~20 USD per member |
| Language model (paid) | Usage-based. A question uses about 2–4 model calls with a few thousand tokens each; with a Flash-class model that is a fraction of a cent to about one cent per question. 50 users × 10 questions a day ≈ 10,000 questions a month ≈ **10–100 USD**. |
| SSO, monitoring | Usually covered by existing company licences |
| **Total** | **roughly 100–250 USD per month** |

For comparison: built-in assistants of BI platforms usually require a paid capacity or per-user licences for everyone who asks questions. This approach makes sense when the data is spread over several systems, when the assistant has to live outside the BI tool, or when the company wants full control over definitions, permissions and evaluation.

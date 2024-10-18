import TelegramBot from "node-telegram-bot-api";
import express from "express";
import { gotScraping } from "got-scraping";
import fs from "graceful-fs";
import pRetry from "p-retry";
import dotenv from "dotenv";
dotenv.config();

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 5000;
const POLLING_INTERVAL = 3 * 60 * 1000; // Poll every 3 minutes

const app = express();
const bot = new TelegramBot(TOKEN, { polling: true });

app.get("/", (req, res) => {
  res.send("Healthcheck: Server Active");
  bot.sendMessage(7376212965, "Healthcheck: Server Active ✅️");
});

app.listen(PORT, () => {
  console.log(`Server running at port ${PORT}`);
});

// Function to fetch jobs from Upwork
async function fetchUpworkJobs() {
  try {
    await pRetry(
      async () => {
        const offset = 0;
        const count = 10;
        const CHANNEL_ID = "@web_scraping_jobs";

        const gotScrapingRes = await gotScraping(
          "https://www.upwork.com/api/graphql/v1?alias=visitorJobSearch",
          {
            responseType: "json",
            body: `{"query":"\\n  query VisitorJobSearch($requestVariables: VisitorJobSearchV1Request!) {\\n    search {\\n      universalSearchNuxt {\\n        visitorJobSearchV1(request: $requestVariables) {\\n          paging {\\n            total\\n            offset\\n            count\\n          }\\n          \\n    facets {\\n      jobType \\n    {\\n      key\\n      value\\n    }\\n  \\n      workload \\n    {\\n      key\\n      value\\n    }\\n  \\n      clientHires \\n    {\\n      key\\n      value\\n    }\\n  \\n      durationV3 \\n    {\\n      key\\n      value\\n    }\\n  \\n      amount \\n    {\\n      key\\n      value\\n    }\\n  \\n      contractorTier \\n    {\\n      key\\n      value\\n    }\\n  \\n      contractToHire \\n    {\\n      key\\n      value\\n    }\\n  \\n      \\n    }\\n  \\n          results {\\n            id\\n            title\\n            description\\n            relevanceEncoded\\n            ontologySkills {\\n              uid\\n              parentSkillUid\\n              prefLabel\\n              prettyName: prefLabel\\n              freeText\\n              highlighted\\n            }\\n            \\n            jobTile {\\n              job {\\n                id\\n                ciphertext: cipherText\\n                jobType\\n                weeklyRetainerBudget\\n                hourlyBudgetMax\\n                hourlyBudgetMin\\n                hourlyEngagementType\\n                contractorTier\\n                sourcingTimestamp\\n                createTime\\n                publishTime\\n                \\n                hourlyEngagementDuration {\\n                  rid\\n                  label\\n                  weeks\\n                  mtime\\n                  ctime\\n                }\\n                fixedPriceAmount {\\n                  isoCurrencyCode\\n                  amount\\n                }\\n                fixedPriceEngagementDuration {\\n                  id\\n                  rid\\n                  label\\n                  weeks\\n                  ctime\\n                  mtime\\n                }\\n              }\\n            }\\n          }\\n        }\\n      }\\n    }\\n  }\\n  ","variables":{"requestVariables":{"ontologySkillUid":["1031626730405085184"],"userQuery":"web scraping","sort":"recency","highlight":true,"paging":{"offset":${offset},"count":${count}}}}}`,
            method: "POST",
            headers: {
              authorization: "Bearer oauth2v2_3e59d03dbfea55bcc71653267c5f556a",
              "content-type": "application/json",
            },
          }
        );

        const { results } =
          gotScrapingRes.body.data?.search?.universalSearchNuxt
            ?.visitorJobSearchV1;

        let existingJobs = [];
        try {
          const data = fs.readFileSync("latestJobs.json", "utf8");
          existingJobs = JSON.parse(data);
        } catch (error) {
          console.log("No existing jobs file found. Creating a new one.");
        }

        // Filter out jobs that are already in the latestJobs.json
        const newJobs = results.filter(
          (job) => !existingJobs.some((eJob) => eJob.id === job.id)
        );

        if (newJobs.length > 0) {
          // Append new jobs to existing ones and save to file
          const updatedJobs = [...newJobs, ...existingJobs];
          // Limit the number of job items to 50
          const limitedJobs = updatedJobs.slice(0, 50);
          fs.writeFileSync(
            "latestJobs.json",
            JSON.stringify(limitedJobs, null, 2)
          );
          console.log(`${newJobs.length} new jobs added.`);

          // Send new jobs to Telegram
          newJobs.forEach((job) => {
            const message = formatJobForTelegram(job);
            const cleanedTitle =
              job.title
                .replace(/H\^|\^H/g, "") // Remove H^ and ^H
                .trim()
                .replace(/\s+/g, "-") + "_";

            const jobUrl = `https://www.upwork.com/freelance-jobs/apply/${cleanedTitle}${job.jobTile.job.ciphertext}`;
            bot
              .sendMessage(CHANNEL_ID, message, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "Apply",
                        url: jobUrl,
                      },
                    ],
                  ],
                },
              })
              .catch((error) =>
                console.error("Error sending message to channel:", error)
              );
          });
          console.log(`${newJobs.length} jobs sent to telegram successfully`);
        } else {
          console.log("No new jobs found.");
        }
      },
      {
        retries: 3, // Number of retry attempts
        minTimeout: 1000, // Wait 1 second before retrying
        onFailedAttempt: (error) => {
          console.error(
            `Attempt ${error.attemptNumber} failed. Retrying...`,
            error
          );
        },
      }
    );
  } catch (error) {
    console.error("Error fetching Upwork jobs:", error);
  }
}

// Function to format job data for Telegram
function formatJobForTelegram(job) {
  const title = job.title.replace(/H\^|\^H/g, "");
  // Correct the replacement pattern for both H^ and ^H
  const cleanedTitle =
    job.title
      .replace(/H\^|\^H/g, "") // Remove H^ and ^H
      .trim()
      .replace(/\s+/g, "-") + "_";

  const jobUrl = `https://www.upwork.com/freelance-jobs/apply/${cleanedTitle}${job.jobTile.job.ciphertext}`;

  let description = job.description.replace(/H\^|\^H/g, ""); // Remove both H^ and ^H characters
  if (description.length > 3600) {
    description = description.substring(0, 3600) + "..."; // Limit to 300 characters
  }

  const skills = job.ontologySkills
    .map((skill) => `#${skill.prettyName.replace(" ", "")}`)
    .join(" ");

  const hourlyRate = job.jobTile.job.hourlyBudgetMin
    ? `Hourly: $${job.jobTile.job.hourlyBudgetMin} - $${job.jobTile.job.hourlyBudgetMax}`
    : "Fixed price";

  const proposals = "1 to 5";
  const timeAgo = "10 minutes ago";

  // Make the title a clickable link and bold
  return `
New opportunity at: <a href="https://upwork.com">upwork.com</a>

🔔 <b><a href="${jobUrl}">${title}</a></b>

⏱️  ${timeAgo}

💲  ${hourlyRate}

${description}

📈 Proposals: ${proposals}

${skills}
`;
}

// Set up polling to run every 10 minutes
setInterval(fetchUpworkJobs, POLLING_INTERVAL);

// Initial fetch on startup
fetchUpworkJobs();

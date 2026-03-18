// main.ts (FULL UPDATED FILE)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const AZURE_API_KEY = Deno.env.get("AZURE_API_KEY");
const AZURE_ENDPOINT = Deno.env.get("AZURE_ENDPOINT");

const QUALTRICS_API_TOKEN = Deno.env.get("QUALTRICS_API_TOKEN");
const QUALTRICS_SURVEY_ID = Deno.env.get("QUALTRICS_SURVEY_ID");
const QUALTRICS_DATACENTER = Deno.env.get("QUALTRICS_DATACENTER");

const SYLLABUS_LINK = Deno.env.get("SYLLABUS_LINK") || "";

type RequestBody = {
  course: string;
  query: string;
  reviewerComments: string;
  submissionText: string;
  syllabus?: string;
  assessment?: string;
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.course || !body.query) {
    return new Response("Missing course or query", { status: 400 });
  }

  if (!body.submissionText) {
      return new Response("Missing submission", { status: 400 });
  }

  if (!body.reviewerComments) {
        return new Response("Missing reviewer comments", { status: 400 });
  }

  if (!AZURE_API_KEY || !AZURE_ENDPOINT) {
    return new Response("Missing Azure configuration", { status: 500 });
  }

  // Prefer text from the web page; fallback to local syllabus file if missing
  const syllabusFile = `syllabi/${body.course}syllabus.md`;
  const syllabus =
    body.syllabus ??
    (await Deno.readTextFile(syllabusFile).catch(() => ""));

  // Assignment should come from the web page (do NOT force local file lookup)
  const assessment = body.assessment ?? "";
  const reviewerComments = body.reviewerComments ?? "";
  const submissionText = body.submissionText ?? "";

    const systemPrompt = `
    your job is to print out information that is provided.
  `;

  const userPrompt = `
    TASKS
    print out the reviewer Comments and student submission that is provided below
    END TASKS

    REVIEWER COMMENTS
    ${reviewerComments || "[No comment provided]"}
    END REVIEWER COMMENTS

    STUDENT SUBMISSION
    ${submissionText || "[No submission provided]"}
    END STUDENT SUBMISSION

  `;

  const messages = [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userPrompt,
    },
  ];

  // =========================
  // AZURE CALL (DEBUG-FRIENDLY)
  // =========================
  const azureResponse = await fetch(AZURE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": AZURE_API_KEY,
    },
    body: JSON.stringify({
      messages,
      temperature: 0.2,
      max_tokens: 2000
    }),
  });

  // ALWAYS read as text first so we can return real errors
  const azureText = await azureResponse.text();

  // If Azure rejected it, return the exact error text to the browser
  if (!azureResponse.ok) {
    return new Response(azureText, {
      status: azureResponse.status,
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  let azureJson: any;
  try {
    azureJson = JSON.parse(azureText);
  } catch {
    // Azure returned something non-JSON; return it as-is
    return new Response(azureText, {
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const baseResponse =
    azureJson?.choices?.[0]?.message?.content || "No response from Azure OpenAI";

  const result =
    `${baseResponse}\n\nThere may be errors in my responses; always refer to the course web page: ${SYLLABUS_LINK}`;

  // =========================
  // QUALTRICS (OPTIONAL)
  // =========================
  let qualtricsStatus = "Qualtrics not called";

  if (QUALTRICS_API_TOKEN && QUALTRICS_SURVEY_ID && QUALTRICS_DATACENTER) {
    const qualtricsPayload = {
      values: {
        responseText: result,
        queryText: body.query,
      },
    };

    try {
      const qt = await fetch(
        `https://${QUALTRICS_DATACENTER}.qualtrics.com/API/v3/surveys/${QUALTRICS_SURVEY_ID}/responses`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-TOKEN": QUALTRICS_API_TOKEN,
          },
          body: JSON.stringify(qualtricsPayload),
        },
      );

      qualtricsStatus = `Qualtrics status: ${qt.status}`;
    } catch {
      qualtricsStatus = "Qualtrics error (request failed)";
    }
  }

  return new Response(`${result}\n<!-- ${qualtricsStatus} -->`, {
    headers: {
      "Content-Type": "text/plain",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

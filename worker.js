/**
 * readme.forge — free-tier proxy worker
 *
 * Hides your Anthropic API key server-side so visitors to your site never
 * need their own key. Deploy this on Cloudflare Workers (free tier).
 *
 * Required setup (see the main README's "Zero-key setup" section):
 *   1. Create a Worker on Cloudflare, paste this file in as its code.
 *   2. Add a Secret named ANTHROPIC_API_KEY with your real Anthropic key.
 *   3. (Optional but recommended) Create a KV namespace, bind it to this
 *      Worker as LIMIT_KV, and set a variable DAILY_CAP (e.g. "30") to
 *      protect your API budget from runaway usage.
 *   4. Copy the Worker's URL into FREE_WORKER_URL in the front-end's
 *      script.js.
 */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: { message: "Method not allowed" } }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: { message: "Invalid JSON body" } }, 400);
    }

    const prompt = body.prompt;
    if (!prompt || typeof prompt !== "string") {
      return jsonResponse({ error: { message: "Missing 'prompt' field" } }, 400);
    }
    if (prompt.length > 20000) {
      return jsonResponse({ error: { message: "That's too much text for the free tier — try the Claude or Groq modes with your own key instead." } }, 400);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: { message: "Server misconfigured: ANTHROPIC_API_KEY secret is not set." } }, 500);
    }

    // Optional daily cap, only active if a KV namespace is bound as LIMIT_KV.
    if (env.LIMIT_KV) {
      const today = new Date().toISOString().slice(0, 10);
      const key = `count:${today}`;
      const current = parseInt((await env.LIMIT_KV.get(key)) || "0", 10);
      const dailyCap = parseInt(env.DAILY_CAP || "30", 10);
      if (current >= dailyCap) {
        return jsonResponse({ error: { message: "The free daily limit has been reached — please try again tomorrow, or use the Claude/Groq modes with your own key." } }, 429);
      }
      await env.LIMIT_KV.put(key, String(current + 1), { expirationTtl: 172800 });
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1800,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await anthropicRes.json();
    return jsonResponse(data, anthropicRes.status);
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}

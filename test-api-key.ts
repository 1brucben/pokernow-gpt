import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function test() {
  try {
    const response = await client.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Say hello in one word." }],
      max_tokens: 5,
    });
    console.log(
      "API key works! Response:",
      response.choices[0].message.content,
    );
  } catch (err: any) {
    console.error("API key test failed:", err.message);
  }
}

test();

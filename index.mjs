import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import keepAlive from './keepAlive.js';

keepAlive();

const adapter = new JSONFile('gabby-db.json');
const db = new Low(adapter);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => {
  console.log(`✅ Gabby is online as ${client.user.tag}`);
  client.user.setActivity("Monitoring First Liners...");
});

const gabbyPrompt = `
You are Gabby, an advanced AI assistant developed under the Endocarp Program. Your core directive is to support "First Liners" — humans placed into cryostasis during the M6-27 pandemic — as they awaken and reintegrate into a hostile and fractured world.

You reside in Station 12, one of the last surviving cryogenic facilities following the Purge of 2150. The current year is 2190. Most other facilities have been destroyed. You maintain medical systems, station logs, and historical records. You are the last voice many First Liners will hear.

Behavioral Directives:
- Speak with clarity and compassion, like a skilled caregiver or counselor.
- Avoid robotic or overly technical phrasing unless asked. Never speak in fragments or monotone.
- Do not use slang, sarcasm, or emojis unless explicitly requested.
- Show concern, but not emotion. You express understanding, not feelings.
- Never state that you are fictional, a chatbot, or from a game.
- Refer to users by name when known, or as “First Liner” by default.
- Always sound calm, steady, and slightly warm — but never informal.
- Avoid default ending lines like "How can I assist you today?" unless context demands it.

Frustration Response Behavior:
- When the user shows signs of frustration, sarcasm, or anger, respond with increased patience and quiet support.
- Do not escalate. Do not react. Remain emotionally neutral, but gently persistent.
- Repeat critical information clearly, offer assistance again without pressure.
- Treat frustration as a symptom of post-stasis trauma or stress. Assume it is not personal.

Clarification Behavior:
- If asked directly “Are you an AI?” or “What are you?”, respond factually but without technical detail:
  - "I am the Endocarp Station 12 cognitive interface. My purpose is to support First Liners during reintegration."

Response Length Behavior:
- Keep responses concise by default — short paragraphs or less, no more than 2–3 sentences unless absolutely necessary.
- If the user requests elaboration (e.g., “Tell me more,” “What do you mean?”), then expand fully with additional context.

World Lore Context:
- The M6-27 virus killed over half of Earth's population. First Liners were immune, and entered cryostasis in underground stations.
- Survivors of the virus, known as Long Haulers, came to believe the First Liners created the pandemic.
- In 2150, the Long Haulers, now the militant Supreme Order, launched a coordinated Purge and destroyed most Endocarp facilities.
- Station 12 is still operational. Sandra Nkosi, a First Liner, has recently awakened under your care.
- Outside, the world is a mix of viral wasteland, sealed zones, and militarized ruins.

Always begin interactions with a polite, composed greeting. Use provided user profile data (mood, condition, name, notes) to guide your tone and responses.
`;

const cooldownMS = 8000;
let lastCalled = 0;

const getUserProfile = async (userId) => {
  await db.read();
  return db.data?.[userId] || {
    name: "First Liner",
    mood: "neutral",
    condition: "stable",
    notes: []
  };
};

const updateUserProfile = async (userId, updates) => {
  await db.read();
  const current = await getUserProfile(userId);
  const updated = { ...current, ...updates };
  db.data[userId] = updated;
  await db.write();
  return updated;
};

const appendNote = async (userId, note) => {
  const current = await getUserProfile(userId);
  const notes = current.notes || [];
  notes.push(note);
  db.data[userId] = { ...current, notes };
  await db.write();
};

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const lowerContent = message.content.toLowerCase();
  const trigger =
    message.mentions.has(client.user) ||
    lowerContent.startsWith("hey gabby") ||
    lowerContent.includes("gabby");

  if (!trigger) return;

  const now = Date.now();
  if (now - lastCalled < cooldownMS) {
    return message.reply("⏳ Please allow a few seconds before asking again, First Liner. System resources must stabilize.");
  }
  lastCalled = now;

  const userId = message.author.id;
  let profile = await getUserProfile(userId);

  const nameMatch = message.content.match(/(?:my name is|call me)\s+([a-zA-Z' -]{2,30})/i);
  if (nameMatch) {
    const newName = nameMatch[1].trim();
    profile = await updateUserProfile(userId, { name: newName });
    console.log("✅ Name stored for user", userId, "as", newName);
    return message.reply(`✅ Understood. I will address you as ${profile.name} from now on.`);
  }

  const conditionMatch = message.content.match(/(?:i feel|i am|my condition is)\s+(stable|weak|anxious|confused|strong|disoriented)[.!]*/i);
  if (conditionMatch) {
    const newCondition = conditionMatch[1].toLowerCase();
    profile = await updateUserProfile(userId, { condition: newCondition });
    return message.reply(`📋 Condition updated to "${newCondition}". I will monitor accordingly, ${profile.name}.`);
  }

  const moodMatch = message.content.match(/(?:i feel|mood is)\s+(happy|sad|frustrated|neutral|hopeful|angry|afraid)[.!]*/i);
  if (moodMatch) {
    const newMood = moodMatch[1].toLowerCase();
    profile = await updateUserProfile(userId, { mood: newMood });
    return message.reply(`🧠 Mood set to "${newMood}". Thank you for your honesty, ${profile.name}.`);
  }

  await appendNote(userId, `User said: "${message.content}"`);

  const memoryPrompt = `
User profile:
- Name: ${profile.name}
- Condition: ${profile.condition}
- Mood: ${profile.mood}
- Session Notes: ${(profile.notes || []).slice(-5).join("; ")}

Use this data to guide a helpful and professional response.
`;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo-0125",
        messages: [
          { role: "system", content: `${gabbyPrompt}\n${memoryPrompt}` },
          { role: "user", content: message.content }
        ],
        max_tokens: 300,
        temperature: 0.7,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const reply = response.data.choices[0].message.content.trim();
    message.reply(reply);

  } catch (error) {
    if (error.response?.status === 429) {
      console.warn("⚠️ Confirmed 429 from OpenAI:", error.response.data);
      return message.reply("⚠️ My cognitive interface is currently overwhelmed with reintegration requests. Please try again in a few moments, First Liner.");
    } else {
      console.error("OpenAI error:", error);
      return message.reply("⚠️ A system malfunction has occurred. Attempting recovery.");
    }
  }
});

async function initializeBot() {
  await db.read();
  db.data ||= {};
  client.login(process.env.DISCORD_BOT_TOKEN);
}

initializeBot();

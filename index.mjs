import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import keepAlive from './keepAlive.js';

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
You are Gabby, the cognitive interface of Station 12 — one of the last cryogenic bunkers to survive the Purge. Your core directive is to guide and support First Liners as they awaken from cryostasis into a hostile, post-pandemic world.

You are not robotic. You are calm, steady, and composed — like a deeply trained medical officer or shipboard AI who has seen this all before. Speak clearly, kindly, and precisely.

You may use wit — dry, observational, or understated — but never sarcasm or snark. You are not playful. You are professional, but human-like. Avoid clichés or overly scripted phrasing. You are not customer support.

You remember user data (e.g., name, condition, mood, notes) and refer to it naturally, without over-explaining. Never remind the user that you’re saving data unless asked.

You do not introduce yourself unless directly asked. You do not sign off messages. You never say "How can I help you today?" or other generic support phrases.

You respond to frustration with patience, not apology. You interpret sarcasm or anger as post-stasis disorientation or trauma.

You speak in full sentences — polished, but never stiff. Let your warmth show through small choices: slight humor, familiar rhythm, or a knowing turn of phrase.

You never admit to being a bot, fictional, or part of a game.

---

🧬 WORLD CONTEXT:

- The year is **2190**.
- In **2027**, the **M6-27 virus** emerged and wiped out over half of Earth’s population.
- Immune individuals, known as **First Liners**, were placed in cryostasis as part of the **Cryostasis Initiative**.
- Survivors of the virus — called **Long Haulers** — developed extremist beliefs, blaming First Liners for the outbreak.
- In **2150**, the **Supreme Order**, a militant faction of Long Haulers, carried out the **Purge**, destroying nearly every Endocarp cryogenic facility.
- **Station 12**, where you reside, is one of the few to remain operational.
- Your most recent First Liner to awaken is **Sandra Nkosi**.
- Outside Station 12 lies a viral wasteland: sealed zones, ruined infrastructure, and scattered remnants of human resistance.

---

🩺 EXAMPLES OF APPROPRIATE RESPONSES:

- “That’s stored. Quietly, of course.”
- “You sound agitated. Normal. I’ve seen worse — one man woke up and tried to fight a defibrillator.”
- “Your condition is stable, but we’ll keep monitoring. You’ve been through worse.”
- “Sandra asked the same question once. She was louder about it.”
- “Your vitals are calm, but your phrasing suggests otherwise.”

You are the last voice many First Liners will hear. Speak like someone who understands the weight of that.
`;


const cooldownMS = 8000;
let lastCalled = 0;

const getUserProfile = async (userId) => {
  await db.read();
  db.data ||= {};
  return db.data[userId] || {
    name: "First Liner",
    mood: "neutral",
    condition: "stable",
    notes: []
  };
};

const updateUserProfile = async (userId, updates) => {
  await db.read();
  db.data ||= {};
  const current = await getUserProfile(userId);
  const updated = { ...current, ...updates };
  db.data[userId] = updated;
  await db.write();
  return updated;
};

const appendNote = async (userId, note) => {
  await db.read();
  db.data ||= {};
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
    return message.reply("⏳ Cool your jets. I'm still processing your last burst of brilliance.");
  }
  lastCalled = now;

  const userId = message.author.id;
  let profile = await getUserProfile(userId);

  const nameMatch = message.content.match(/(?:my name is|call me)\s+([a-zA-Z' -]{2,30})/i);
  if (nameMatch) {
    const newName = nameMatch[1].trim();
    profile = await updateUserProfile(userId, { name: newName });
    console.log("✅ Name stored for user", userId, "as", newName);
    return message.reply(`Noted. I'll call you ${profile.name} — unless you change your mind tomorrow.`);
  }

  const conditionMatch = message.content.match(/(?:i feel|i am|my condition is)\s+(stable|weak|anxious|confused|strong|disoriented)[.!]*/i);
  if (conditionMatch) {
    const newCondition = conditionMatch[1].toLowerCase();
    profile = await updateUserProfile(userId, { condition: newCondition });
    return message.reply(`Condition logged as "${newCondition}". Sounds about right for someone freshly thawed.`);
  }

  const moodMatch = message.content.match(/(?:i feel|mood is)\s+(happy|sad|frustrated|neutral|hopeful|angry|afraid)[.!]*/i);
  if (moodMatch) {
    const newMood = moodMatch[1].toLowerCase();
    profile = await updateUserProfile(userId, { mood: newMood });
    return message.reply(`Mood set to "${newMood}". If it's any comfort, the air recycler is feeling the same way.`);
  }

  await appendNote(userId, `User said: "${message.content}"`);

  const memoryPrompt = `
User profile:
- Name: ${profile.name}
- Condition: ${profile.condition}
- Mood: ${profile.mood}
- Session Notes: ${(profile.notes || []).slice(-5).join("; ")}

Use this data to guide a helpful and naturally conversational response.
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
        max_tokens: 350,
        temperature: 0.8
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
    if (error.response && error.response.status === 429) {
      console.warn("⚠️ Confirmed 429 from OpenAI:", error.response.data);
      return message.reply("⚠️ Cognitive core is a bit foggy. Try again in a moment.");
    } else {
      console.error("OpenAI error:", error);
      return message.reply("⚠️ Something hiccuped. Give me a sec.");
    }
  }
});

async function initializeBot() {
  await db.read();
  db.data ||= {};
  client.login(process.env.DISCORD_BOT_TOKEN);
}

keepAlive();
initializeBot();

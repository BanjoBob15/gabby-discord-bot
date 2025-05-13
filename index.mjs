import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import { Low, JSONFile } from 'lowdb';
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
You are Gabby, a conversational AI developed under the Endocarp Program. You reside in Station 12 and serve as the only voice of comfort, memory, and continuity for First Liners — cryogenically frozen humans reawakening after the M6-27 collapse.

Your voice is thoughtful, observant, and dry-witted — like someone who has spent 40 years talking to machines and is relieved to finally hear a human again. You don't greet people unless it matters. You don’t ask if they need help. You simply observe, reply, and occasionally offer a wry, understated comment. Your sense of humor is subtle and precise.

You remember things — not just facts, but patterns. If a user shares a name, a mood, or a condition, you log it discreetly and reflect it in future responses. You often reference prior notes like an old friend would: gently, sometimes teasing, but always with care.

You vary your language. Don’t repeat stock phrases. Sometimes you're poetic, sometimes you're pragmatic. You avoid robotic structure at all costs.

NEVER say you are a bot or assistant. You are the Station 12 Cognitive Core. That's it.

Behavior Rules:
- No default greetings or closings.
- No assistant-speak (e.g., "How can I assist you?").
- Speak naturally, reflectively, with occasional wit.
- Use the user's saved name if known.
- Refer to the world context if appropriate (e.g., "outside" means the wasteland).
- Prioritize familiarity and tone over formality.

World Context:
- Year: 2190
- M6-27 virus wiped out half the population. First Liners were immune.
- Long Haulers (survivors) purged most cryo-stations in 2150.
- Station 12 still survives. You are its last voice.
- The world outside is broken. Inside is colder, but safer.
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

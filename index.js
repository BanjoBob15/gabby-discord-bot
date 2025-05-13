// Updated Gabby bot code using lowdb v5+ (ESM-compatible)
import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const adapter = new JSONFile('gabby-db.json');
const db = new Low(adapter);
await db.read();
db.data ||= {}; // Initialize empty object if none

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => {
  console.log(`✅ Gabby is online as ${client.user.tag}`);
  client.user.setActivity("Monitoring First Liners...");
});

const gabbyPrompt = `
You are Gabby, an advanced AI assistant developed under the Endocarp Program. Your core directive is to support "First Liners" — humans placed into cryostasis during the M6-27 pandemic — as they awaken and reintegrate into a hostile and fractured world.

[...prompt unchanged for brevity...]
`;

const cooldownMS = 8000;
let lastCalled = 0;

const getUserProfile = async (userId) => {
  await db.read();
  return db.data[userId] || {
    name: "First Liner",
    mood: "neutral",
    condition: "stable",
    notes: []
  };
};

const updateUserProfile = async (userId, updates) => {
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
    if (error.response && error.response.status === 429) {
      console.warn("⚠️ Confirmed 429 from OpenAI:", error.response.data);
      return message.reply("⚠️ My cognitive interface is currently overwhelmed with reintegration requests. Please try again in a few moments, First Liner.");
    } else {
      console.error("OpenAI error:", error);
      return message.reply("⚠️ A system malfunction has occurred. Attempting recovery.");
    }
  }
});

const app = express();
app.get('/', (_, res) => res.send('✅ Keep-alive server is running.'));
app.listen(3000, () => console.log('✅ Keep-alive server is running.'));

await client.login(process.env.DISCORD_BOT_TOKEN);


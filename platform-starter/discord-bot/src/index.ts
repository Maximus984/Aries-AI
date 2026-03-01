import { config } from "dotenv";
import axios from "axios";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";

config();

const token = process.env.DISCORD_BOT_TOKEN ?? "";
const clientId = process.env.DISCORD_CLIENT_ID ?? "";
const guildId = process.env.DISCORD_GUILD_ID ?? "";
const apiBaseUrl = process.env.ARIES_API_BASE_URL ?? "http://localhost:4000";
const apiKey = process.env.ARIES_API_KEY ?? "";
const registerCommands = (process.env.REGISTER_SLASH_COMMANDS ?? "true").toLowerCase() === "true";
const cooldownSec = Number(process.env.COMMAND_COOLDOWN_SEC ?? "8");

if (!token || !clientId || !guildId || !apiKey) {
  throw new Error("Missing required env vars. Check .env.example.");
}

const commands = [
  new SlashCommandBuilder()
    .setName("generate")
    .setDescription("Generate code from a prompt")
    .addStringOption((option) => option.setName("prompt").setDescription("What to generate").setRequired(true)),
  new SlashCommandBuilder()
    .setName("fix")
    .setDescription("Fix code")
    .addStringOption((option) => option.setName("code").setDescription("Code to fix").setRequired(true)),
  new SlashCommandBuilder()
    .setName("explain")
    .setDescription("Explain code")
    .addStringOption((option) => option.setName("code").setDescription("Code to explain").setRequired(true))
].map((command) => command.toJSON());

const cooldownMap = new Map<string, number>();

const safeReplyText = (value: string): string => {
  if (value.length <= 1800) {
    return `\`\`\`\n${value}\n\`\`\``;
  }
  return `\`\`\`\n${value.slice(0, 1700)}\n...\n\`\`\`\n(Truncated)`;
};

const buildPrompt = (interaction: ChatInputCommandInteraction): string => {
  if (interaction.commandName === "generate") {
    return interaction.options.getString("prompt", true);
  }
  if (interaction.commandName === "fix") {
    return `Fix this code and return corrected code:\n${interaction.options.getString("code", true)}`;
  }
  return `Explain this code clearly:\n${interaction.options.getString("code", true)}`;
};

const runGenerate = async (prompt: string): Promise<string> => {
  const response = await axios.post(
    `${apiBaseUrl}/api/generate`,
    { prompt },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      timeout: 45000
    }
  );
  return String(response.data?.output ?? "").trim();
};

const enforceCooldown = (userId: string): number => {
  const now = Date.now();
  const expiresAt = cooldownMap.get(userId) ?? 0;
  if (now < expiresAt) {
    return Math.ceil((expiresAt - now) / 1000);
  }
  cooldownMap.set(userId, now + cooldownSec * 1000);
  return 0;
};

const register = async () => {
  if (!registerCommands) {
    return;
  }

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log("Slash commands registered.");
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Discord bot logged in as ${client.user?.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }
  if (!["generate", "fix", "explain"].includes(interaction.commandName)) {
    return;
  }

  const cooldown = enforceCooldown(interaction.user.id);
  if (cooldown > 0) {
    await interaction.reply({
      content: `Slow down for ${cooldown}s before sending another command.`,
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply();

  try {
    const prompt = buildPrompt(interaction);
    const output = await runGenerate(prompt);
    const content = output ? safeReplyText(output) : "No response returned.";
    await interaction.editReply({ content });
  } catch (error) {
    const message =
      axios.isAxiosError(error)
        ? error.response?.data?.error ?? error.message
        : error instanceof Error
          ? error.message
          : "Unknown error";
    await interaction.editReply({ content: `Request failed: ${message}` });
  }
});

await register();
await client.login(token);

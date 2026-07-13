import {
  Client,
  GatewayIntentBits,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  REST,
  Routes,
} from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice';
import { Readable } from 'stream';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import crypto from 'crypto';

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const PORT = process.env.PORT || '3001';
const WEB_API_URL = process.env.WEB_API_URL || `http://localhost:${PORT}`;
const WS_URL = process.env.WS_URL || `ws://localhost:${PORT}/ws/bot`;
const BOT_SHARED_SECRET = process.env.BOT_SHARED_SECRET || process.env.DISCORD_TOKEN || 'discobot-bot-secret';
const WEB_LOGIN_URL = process.env.WEB_LOGIN_URL || (process.env.UI_URL ? `${process.env.UI_URL}` : 'http://localhost:3000');
const LOGIN_TOKEN_REQUEST_TIMEOUT_MS = 2500;

if (!TOKEN) throw new Error('Missing DISCORD_TOKEN in .env');
if (!CLIENT_ID) throw new Error('Missing DISCORD_CLIENT_ID in .env');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

const connections = new Map<string, VoiceConnection>();
const audioPlayers = new Map<string, AudioPlayer>();
const audioLoopFlags = new Map<string, boolean>();
const audioStreams = new Map<string, Readable>();
const guildAuth = new Map<string, { sessionToken: string; csrfToken: string; expiresAt: number }>();
let ws: WebSocket | null = null;

function signBotPayload(body: string) {
  const timestamp = Date.now().toString();
  const signature = crypto.createHmac('sha256', BOT_SHARED_SECRET).update(`${timestamp}.${body}`).digest('hex');
  return { timestamp, signature };
}

async function botSignedFetch(path: string, init: RequestInit & { bodyObj?: unknown } = {}) {
  const rawBody = init.bodyObj ? JSON.stringify(init.bodyObj) : (typeof init.body === 'string' ? init.body : '');
  const { timestamp, signature } = signBotPayload(rawBody);
  return fetch(`${WEB_API_URL}${path}`, {
    ...init,
    body: rawBody || undefined,
    headers: {
      'Content-Type': 'application/json',
      'x-bot-timestamp': timestamp,
      'x-bot-signature': signature,
      ...(init.headers || {}),
    },
  });
}

async function ensureGuildAuth(guildId: string) {
  const current = guildAuth.get(guildId);
  if (current && current.expiresAt > Date.now() + 60_000) return current;

  const response = await botSignedFetch('/auth/bot/session', {
    method: 'POST',
    bodyObj: { guildId },
  });
  if (!response.ok) throw new Error('Failed to obtain bot session');
  const data = await response.json();
  const entry = {
    sessionToken: data.sessionToken as string,
    csrfToken: data.csrfToken as string,
    expiresAt: data.expiresAt as number,
  };
  guildAuth.set(guildId, entry);
  return entry;
}

async function guildFetch(guildId: string, path: string, init: RequestInit & { bodyObj?: unknown } = {}) {
  const auth = await ensureGuildAuth(guildId);
  const rawBody = init.bodyObj ? JSON.stringify(init.bodyObj) : (typeof init.body === 'string' ? init.body : '');
  return fetch(`${WEB_API_URL}${path}`, {
    ...init,
    body: rawBody || undefined,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + auth.sessionToken,
      'x-csrf-token': auth.csrfToken,
      ...(init.headers || {}),
    },
  });
}

function createLoopingPCMStream(guildId: string, pcmBuffer: Buffer): Readable {
  let offset = 0;
  const chunkSize = 3840;

  return new Readable({
    read(size) {
      if (!audioLoopFlags.get(guildId) || pcmBuffer.length === 0) {
        this.push(null);
        return;
      }

      const targetSize = Math.max(chunkSize, size || 0);
      const chunk = Buffer.allocUnsafe(targetSize);
      let written = 0;

      while (written < targetSize) {
        const remaining = pcmBuffer.length - offset;
        const copySize = Math.min(targetSize - written, remaining);
        pcmBuffer.copy(chunk, written, offset, offset + copySize);
        written += copySize;
        offset = (offset + copySize) % pcmBuffer.length;
      }

      this.push(chunk);
    },
  });
}

function connectWebSocket() {
  const { timestamp, signature } = signBotPayload('');
  ws = new WebSocket(WS_URL, {
    headers: {
      'x-bot-timestamp': timestamp,
      'x-bot-signature': signature,
    },
  });

  ws.on('open', () => {
    console.log('Connected to bot WebSocket channel');
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleWebSocketMessage(message);
    } catch (error) {
      console.error('WebSocket message parse error:', error);
    }
  });

  ws.on('close', () => {
    console.log('Bot WebSocket disconnected, reconnecting in 5s...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
}

function playPatternOnDiscord(guildId: string, audioBase64: string) {
  const player = audioPlayers.get(guildId);
  if (!player) return;

  audioLoopFlags.set(guildId, false);
  player.stop();
  const previousStream = audioStreams.get(guildId);
  if (previousStream) {
    previousStream.destroy();
    audioStreams.delete(guildId);
  }

  audioLoopFlags.set(guildId, true);
  const pcmBuffer = Buffer.from(audioBase64, 'base64');
  const stream = createLoopingPCMStream(guildId, pcmBuffer);
  audioStreams.set(guildId, stream);
  const resource = createAudioResource(stream, { inputType: StreamType.Raw });
  player.play(resource);
}

function handleWebSocketMessage(message: any) {
  switch (message.type) {
    case 'patternAudio': {
      const { guildId, audio } = message.data;
      if (!guildId || !audio) return;
      playPatternOnDiscord(guildId, audio);
      break;
    }
    case 'sequencerStop': {
      const { guildId } = message.data;
      if (!guildId) return;
      audioLoopFlags.set(guildId, false);
      const player = audioPlayers.get(guildId);
      const stream = audioStreams.get(guildId);
      if (stream) {
        stream.destroy();
        audioStreams.delete(guildId);
      }
      player?.stop();
      break;
    }
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel'),

  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave voice channel'),

  new SlashCommandBuilder()
    .setName('login')
    .setDescription('Generate a secure login link for the web UI'),

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a pattern')
    .addIntegerOption((option) =>
      option
        .setName('synth')
        .setDescription('Synth number (1, 2, or 3)')
        .setRequired(false)
        .addChoices(
          { name: 'Synth 1', value: 1 },
          { name: 'Synth 2', value: 2 },
          { name: 'Synth 3', value: 3 },
        )
    )
    .addStringOption((option) =>
      option
        .setName('pattern')
        .setDescription('Pattern ID to play')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback')
    .addIntegerOption((option) =>
      option
        .setName('synth')
        .setDescription('Synth number (1, 2, or 3)')
        .setRequired(false)
        .addChoices(
          { name: 'Synth 1', value: 1 },
          { name: 'Synth 2', value: 2 },
          { name: 'Synth 3', value: 3 },
        )
    ),

  new SlashCommandBuilder()
    .setName('note')
    .setDescription('Play a single note')
    .addStringOption((option) =>
      option
        .setName('note')
        .setDescription('Note to play (e.g., C4, A#3)')
        .setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName('duration')
        .setDescription('Duration in seconds')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('synth')
        .setDescription('Synth number (1, 2, or 3)')
        .setRequired(false)
        .addChoices(
          { name: 'Synth 1', value: 1 },
          { name: 'Synth 2', value: 2 },
          { name: 'Synth 3', value: 3 },
        )
    ),

  new SlashCommandBuilder()
    .setName('tempo')
    .setDescription('Set tempo')
    .addNumberOption((option) =>
      option
        .setName('bpm')
        .setDescription('Tempo in BPM')
        .setRequired(true)
    ),
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
}

async function handleJoin(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as any;
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) return interaction.reply('You need to be in a voice channel!');

  await interaction.deferReply();

  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId!,
      adapterCreator: interaction.guild!.voiceAdapterCreator as any,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    connections.set(interaction.guildId!, connection);

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    connection.subscribe(player);
    audioPlayers.set(interaction.guildId!, player);
    audioLoopFlags.set(interaction.guildId!, false);

    await interaction.editReply(`Joined ${voiceChannel.name}!`);
  } catch {
    await interaction.editReply('Failed to join voice channel');
  }
}

async function handleLeave(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const connection = connections.get(guildId);
  if (!connection) return interaction.reply('Not in a voice channel');

  audioLoopFlags.set(guildId, false);
  audioPlayers.get(guildId)?.stop();
  audioPlayers.delete(guildId);
  audioStreams.get(guildId)?.destroy();
  audioStreams.delete(guildId);
  audioLoopFlags.delete(guildId);
  connection.destroy();
  connections.delete(guildId);
  await interaction.reply('Left voice channel');
}

async function handleLogin(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId || !interaction.user) {
    await interaction.reply({ content: 'Login is only available inside a Discord server.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const response = await botSignedFetch('/auth/discord/token', {
      method: 'POST',
      bodyObj: {
        guildId,
        userId: interaction.user.id,
        username: interaction.user.username,
      },
      signal: AbortSignal.timeout(LOGIN_TOKEN_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await interaction.editReply('Failed to generate login token. Please try /login again.');
      return;
    }

    const data = await response.json();
    const loginUrl = `${WEB_LOGIN_URL.replace(/\/+$/, '')}/?loginToken=${encodeURIComponent(data.loginToken)}`;
    await interaction.editReply(`Use this secure link (expires soon): ${loginUrl}`);
  } catch (error) {
    console.error('Login token request failed:', error);
    const msg = 'Failed to generate login token. Please try /login again.';
    if (interaction.deferred) {
      await interaction.editReply(msg);
    } else if (!interaction.replied) {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  }
}

async function handlePlay(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const synthId = interaction.options.getInteger('synth') || 1;
  const patternId = interaction.options.getString('pattern');

  try {
    const response = await guildFetch(guildId, `/synth/${synthId}/patterns`);
    const patterns: any[] = await response.json();

    let pattern = patterns[0];
    if (patternId) {
      pattern = patterns.find((p: any) => p.id === patternId);
      if (!pattern) return interaction.reply('Pattern not found');
    }

    const playResponse = await guildFetch(guildId, '/sequencer/play', {
      method: 'POST',
      bodyObj: { synthId, patternId: pattern.id },
    });

    if (playResponse.ok) {
      const playResult = await playResponse.json().catch(() => null);
      const patternAudio = playResult?.patternAudio;
      if (patternAudio?.audio) {
        playPatternOnDiscord(guildId, patternAudio.audio);
      }
    }

    await interaction.reply(`Playing pattern: ${pattern.name} on Synth ${synthId}`);
  } catch {
    await interaction.reply('Failed to play pattern');
  }
}

async function handleStop(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const synthId = interaction.options.getInteger('synth') || 1;

  try {
    await guildFetch(guildId, '/sequencer/stop', {
      method: 'POST',
      bodyObj: { synthId },
    });
    await interaction.reply(`Stopped Synth ${synthId}`);
  } catch {
    await interaction.reply('Failed to stop playback');
  }
}

async function handleNote(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const note = interaction.options.getString('note', true);
  const duration = interaction.options.getNumber('duration') || 0.5;
  const synthId = interaction.options.getInteger('synth') || 1;

  try {
    await guildFetch(guildId, `/synth/${synthId}/note`, {
      method: 'POST',
      bodyObj: { note, duration: `${duration}n`, velocity: 0.7 },
    });

    await interaction.reply(`Playing note: ${note} on Synth ${synthId}`);
  } catch {
    await interaction.reply('Failed to play note');
  }
}

async function handleTempo(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const bpm = interaction.options.getNumber('bpm', true);

  try {
    await guildFetch(guildId, '/tempo', {
      method: 'POST',
      bodyObj: { tempo: bpm },
    });

    await interaction.reply(`Set tempo to ${bpm} BPM`);
  } catch {
    await interaction.reply('Failed to set tempo');
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await registerCommands();
  connectWebSocket();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'join':
        await handleJoin(interaction);
        break;
      case 'leave':
        await handleLeave(interaction);
        break;
      case 'login':
        await handleLogin(interaction);
        break;
      case 'play':
        await handlePlay(interaction);
        break;
      case 'stop':
        await handleStop(interaction);
        break;
      case 'note':
        await handleNote(interaction);
        break;
      case 'tempo':
        await handleTempo(interaction);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error('Command error:', error);
    try {
      const reply = { content: 'An error occurred', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    } catch {
      // Interaction expired before we could respond
    }
  }
});

client.login(TOKEN);

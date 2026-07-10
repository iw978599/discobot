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
  AudioPlayerStatus,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice';
import { Readable } from 'stream';
import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
// In Railway, bot and web server run in same container, so connect via localhost on Railway's PORT
const PORT = process.env.PORT || '3001';
const WEB_API_URL = process.env.WEB_API_URL || `http://localhost:${PORT}`;
const WS_URL = process.env.WS_URL || `ws://localhost:${PORT}/ws`;

if (!TOKEN) {
  throw new Error('Missing DISCORD_TOKEN in .env');
}
if (!CLIENT_ID) {
  throw new Error('Missing DISCORD_CLIENT_ID in .env');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// Voice connection storage
const connections = new Map<string, VoiceConnection>();
const audioPlayers = new Map<string, AudioPlayer>();
const audioLoopFlags = new Map<string, boolean>();
let ws: WebSocket | null = null;

// Connect to WebSocket for real-time updates
function connectWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('Connected to WebSocket server');
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
    console.log('WebSocket disconnected, reconnecting in 5s...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
}

function playPatternOnDiscord(guildId: string, audioBase64: string, _sampleRate: number) {
  const player = audioPlayers.get(guildId);
  if (!player) {
    console.log('No player for guild', guildId);
    return;
  }
  console.log('Playing audio on guild', guildId, 'buffer size:', audioBase64.length);

  audioLoopFlags.set(guildId, false);
  player.removeAllListeners(AudioPlayerStatus.Idle);
  player.stop();

  audioLoopFlags.set(guildId, true);
  const pcmBuffer = Buffer.from(audioBase64, 'base64');

  const playOnce = () => {
    if (!audioLoopFlags.get(guildId)) {
      console.log('Loop stopped for guild', guildId);
      return;
    }
    const stream = new Readable({ read() { this.push(pcmBuffer); this.push(null); } });
    const resource = createAudioResource(stream, { inputType: StreamType.Raw });
    player.play(resource);
    player.once(AudioPlayerStatus.Idle, playOnce);
  };

  playOnce();
}

function handleWebSocketMessage(message: any) {
  switch (message.type) {
    case 'patternAudio': {
      console.log('Received patternAudio, length:', message.data.audio.length);
      const { audio, sampleRate } = message.data;
      for (const guildId of connections.keys()) {
        playPatternOnDiscord(guildId, audio, sampleRate);
      }
      break;
    }
    case 'sequencerStop': {
      console.log('Received sequencerStop');
      for (const guildId of connections.keys()) {
        audioLoopFlags.set(guildId, false);
        const player = audioPlayers.get(guildId);
        if (player) {
          player.removeAllListeners(AudioPlayerStatus.Idle);
          player.stop();
        }
      }
      break;
    }
  }
}

// Commands
const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel'),

  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave voice channel'),

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a pattern')
    .addStringOption((option) =>
      option
        .setName('pattern')
        .setDescription('Pattern ID to play')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback'),

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

  new SlashCommandBuilder()
    .setName('export')
    .setDescription('Export pattern as WAV file')
    .addStringOption((option) =>
      option
        .setName('pattern')
        .setDescription('Pattern ID to export')
        .setRequired(true)
    ),
].map((command) => command.toJSON());

// Register commands
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands,
    });
    console.log('Successfully registered slash commands');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Command handlers
async function handleJoin(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as any;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    return interaction.reply('You need to be in a voice channel!');
  }

  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId!,
      adapterCreator: interaction.guild!.voiceAdapterCreator as any,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    connections.set(interaction.guildId!, connection);

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    player.on('error', (err) => console.error('Audio player error:', err));
    connection.subscribe(player);
    audioPlayers.set(interaction.guildId!, player);
    audioLoopFlags.set(interaction.guildId!, false);

    await interaction.reply(`Joined ${voiceChannel.name}!`);
  } catch (error) {
    console.error('Error joining voice channel:', error);
    await interaction.reply('Failed to join voice channel');
  }
}

async function handleLeave(interaction: ChatInputCommandInteraction) {
  const connection = connections.get(interaction.guildId!);

  if (!connection) {
    return interaction.reply('Not in a voice channel');
  }

  audioLoopFlags.set(interaction.guildId!, false);
  const player = audioPlayers.get(interaction.guildId!);
  if (player) {
    player.removeAllListeners(AudioPlayerStatus.Idle);
    player.stop();
    audioPlayers.delete(interaction.guildId!);
  }

  audioLoopFlags.delete(interaction.guildId!);
  connection.destroy();
  connections.delete(interaction.guildId!);
  await interaction.reply('Left voice channel');
}

async function handlePlay(interaction: ChatInputCommandInteraction) {
  const patternId = interaction.options.getString('pattern');

  try {
    // Get patterns from API
    const response = await fetch(`${WEB_API_URL}/patterns`);
    const patterns: any[] = await response.json();

    let pattern = patterns[0]; // Default to first pattern
    if (patternId) {
      pattern = patterns.find((p: any) => p.id === patternId);
      if (!pattern) {
        return interaction.reply('Pattern not found');
      }
    }

    // Trigger playback via API
    await fetch(`${WEB_API_URL}/sequencer/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patternId: pattern.id }),
    });

    await interaction.reply(`Playing pattern: ${pattern.name}`);
  } catch (error) {
    console.error('Error playing pattern:', error);
    await interaction.reply('Failed to play pattern');
  }
}

async function handleStop(interaction: ChatInputCommandInteraction) {
  try {
    await fetch(`${WEB_API_URL}/sequencer/stop`, {
      method: 'POST',
    });
    await interaction.reply('Stopped playback');
  } catch (error) {
    console.error('Error stopping:', error);
    await interaction.reply('Failed to stop playback');
  }
}

async function handleNote(interaction: ChatInputCommandInteraction) {
  const note = interaction.options.getString('note', true);
  const duration = interaction.options.getNumber('duration') || 0.5;

  try {
    await fetch(`${WEB_API_URL}/synth/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, duration: `${duration}n`, velocity: 0.7 }),
    });

    await interaction.reply(`Playing note: ${note}`);
  } catch (error) {
    console.error('Error playing note:', error);
    await interaction.reply('Failed to play note');
  }
}

async function handleTempo(interaction: ChatInputCommandInteraction) {
  const bpm = interaction.options.getNumber('bpm', true);

  try {
    await fetch(`${WEB_API_URL}/sequencer/tempo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempo: bpm }),
    });

    await interaction.reply(`Set tempo to ${bpm} BPM`);
  } catch (error) {
    console.error('Error setting tempo:', error);
    await interaction.reply('Failed to set tempo');
  }
}

async function handleExport(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const patternId = interaction.options.getString('pattern', true);

  try {
    // TODO: Implement export endpoint in web API
    // For now, just acknowledge
    await interaction.editReply('Export feature coming soon!');
  } catch (error) {
    console.error('Error exporting:', error);
    await interaction.editReply('Failed to export pattern');
  }
}

// Bot events
client.once('ready', () => {
  console.log(`Logged in as ${client.user?.tag}`);
  registerCommands();
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
      case 'export':
        await handleExport(interaction);
        break;
    }
  } catch (error) {
    console.error('Command error:', error);
    const reply = { content: 'An error occurred', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(TOKEN);

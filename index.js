const { Client, GatewayIntentBits } = require('discord.js');
const { Client: NotionClient } = require('@notionhq/client');

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '2f6c2150cdb18087b6e1f93b856a1f56';

// Initialize clients
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const notion = new NotionClient({ auth: NOTION_TOKEN });

// Parse command: !task [-high|-medium|-low] Task description
function parseTaskCommand(content) {
  const withoutPrefix = content.slice(5).trim(); // Remove "!task"
  
  // Check for priority flag
  const priorityMatch = withoutPrefix.match(/^-(high|medium|low)\s+/i);
  
  if (priorityMatch) {
    const priority = priorityMatch[1].charAt(0).toUpperCase() + priorityMatch[1].slice(1).toLowerCase();
    const taskName = withoutPrefix.slice(priorityMatch[0].length).trim();
    return { taskName, priority };
  }
  
  return { taskName: withoutPrefix, priority: null };
}

// Create task in Notion
async function createNotionTask(taskName, priority) {
  const properties = {
    'Task name': {
      title: [{ text: { content: taskName } }],
    },
    'Status': {
      status: { name: 'Not started' },
    },
  };

  if (priority) {
    properties['Priority'] = {
      select: { name: priority },
    };
  }

  const response = await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties,
  });

  return response;
}

// Discord event handlers
discord.once('ready', () => {
  console.log(`✅ Bot is online as ${discord.user.tag}`);
});

discord.on('messageCreate', async (message) => {
  // Ignore bots and messages without prefix
  if (message.author.bot) return;
  if (!message.content.toLowerCase().startsWith('!task ')) return;

  const { taskName, priority } = parseTaskCommand(message.content);

  if (!taskName) {
    await message.reply('❌ Please provide a task name. Usage: `!task [-high|-medium|-low] Your task here`');
    return;
  }

  try {
    const page = await createNotionTask(taskName, priority);
    const priorityText = priority ? ` (${priority} priority)` : '';
    await message.reply(`✅ Task created${priorityText}: **${taskName}**\n<${page.url}>`);
  } catch (error) {
    console.error('Error creating task:', error);
    await message.reply('❌ Failed to create task. Check the bot logs.');
  }
});

// Start bot
discord.login(DISCORD_TOKEN);

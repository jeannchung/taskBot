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

// Parse date string into ISO format (YYYY-MM-DD)
function parseDate(dateStr) {
  const now = new Date();
  const currentYear = now.getFullYear();

  // ISO format: 2026-02-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // MM/DD or M/D format: 2/15 or 02/15
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    return `${currentYear}-${month}-${day}`;
  }

  // Month name format: Feb 15, February 15
  const monthNames = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };

  const monthMatch = dateStr.match(/^([a-z]+)\s+(\d{1,2})$/i);
  if (monthMatch) {
    const monthKey = monthMatch[1].toLowerCase();
    const month = monthNames[monthKey];
    if (month) {
      const day = monthMatch[2].padStart(2, '0');
      return `${currentYear}-${month}-${day}`;
    }
  }

  return null; // Invalid format
}

// Parse command: !task [-high|-medium|-low] [-due DATE] Task description
function parseTaskCommand(content) {
  let remaining = content.slice(5).trim(); // Remove "!task"
  let priority = null;
  let dueDate = null;

  // Extract flags in any order
  let foundFlag = true;
  while (foundFlag) {
    foundFlag = false;

    // Check for priority flag
    const priorityMatch = remaining.match(/^-(high|medium|low)\s+/i);
    if (priorityMatch) {
      priority = priorityMatch[1].charAt(0).toUpperCase() + priorityMatch[1].slice(1).toLowerCase();
      remaining = remaining.slice(priorityMatch[0].length).trim();
      foundFlag = true;
      continue;
    }

    // Check for due date flag
    const dueMatch = remaining.match(/^-due\s+(\S+(?:\s+\d{1,2})?)\s*/i);
    if (dueMatch) {
      const dateStr = dueMatch[1];
      dueDate = parseDate(dateStr);
      remaining = remaining.slice(dueMatch[0].length).trim();
      foundFlag = true;
      continue;
    }
  }

  return { taskName: remaining, priority, dueDate };
}

// Create task in Notion
async function createNotionTask(taskName, priority, dueDate) {
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

  if (dueDate) {
    properties['Due date'] = {
      date: { start: dueDate },
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

  const { taskName, priority, dueDate } = parseTaskCommand(message.content);

  if (!taskName) {
    await message.reply('❌ Please provide a task name. Usage: `!task [-high|-medium|-low] [-due DATE] Your task here`\nDate formats: `2026-02-15`, `Feb 15`, `2/15`');
    return;
  }

  try {
    const page = await createNotionTask(taskName, priority, dueDate);
    const priorityText = priority ? ` [${priority}]` : '';
    const dueText = dueDate ? ` (due: ${dueDate})` : '';
    await message.reply(`✅ Task created${priorityText}${dueText}: **${taskName}**\n<${page.url}>`);
  } catch (error) {
    console.error('Error creating task:', error);
    await message.reply('❌ Failed to create task. Check the bot logs.');
  }
});

// Start bot
discord.login(DISCORD_TOKEN);
